import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  decryptSecret,
  encryptSecret,
  signOAuthState,
  verifyOAuthState,
} from '../common/secret.util';
import { BlingClient, type BlingTokenResponse } from './bling.client';

export type BlingConnectionView = {
  connected: boolean;
  status: string | null;
  accountLabel: string | null;
  lastSyncAt: string | null;
  configured: boolean;
};

export type BlingSyncSummary = {
  created: number;
  updated: number;
  stockUpdated: number;
  skipped: number;
  warnings: string[];
};

@Injectable()
export class BlingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bling: BlingClient,
  ) {}

  health() {
    return {
      module: 'bling',
      status: 'ok',
      configured: this.bling.isConfigured(),
    };
  }

  async getAuthorizeUrl(tenantId: string, storeId: string) {
    this.bling.assertConfigured();
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, tenantId },
    });
    if (!store) {
      throw new BadRequestException('Loja não encontrada para este tenant.');
    }
    const state = signOAuthState(tenantId, storeId);
    return {
      url: this.bling.buildAuthorizeUrl(state),
      state,
    };
  }

  async getConnection(
    tenantId: string,
    storeId: string,
  ): Promise<BlingConnectionView> {
    const configured = this.bling.isConfigured();
    const row = await this.prisma.blingConnection.findUnique({
      where: { tenantId_storeId: { tenantId, storeId } },
    });
    if (!row || row.status === 'disconnected') {
      return {
        connected: false,
        status: row?.status ?? null,
        accountLabel: null,
        lastSyncAt: null,
        configured,
      };
    }
    return {
      connected: row.status === 'connected',
      status: row.status,
      accountLabel: row.accountLabel,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      configured,
    };
  }

  async completeOAuth(code: string, state: string) {
    this.bling.assertConfigured();
    const parsed = verifyOAuthState(state);
    if (!parsed) {
      throw new BadRequestException('State OAuth inválido ou adulterado.');
    }
    const { tenantId, storeId } = parsed;

    const store = await this.prisma.store.findFirst({
      where: { id: storeId, tenantId },
    });
    if (!store) {
      throw new BadRequestException('Loja não encontrada para este tenant.');
    }

    let tokens: BlingTokenResponse;
    try {
      tokens = await this.bling.exchangeCode(code);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Falha ao trocar código OAuth do Bling.',
      );
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const data = {
      accessTokenEnc: encryptSecret(tokens.access_token),
      refreshTokenEnc: encryptSecret(tokens.refresh_token),
      expiresAt,
      status: 'connected',
      accountLabel: store.name,
    };

    await this.prisma.blingConnection.upsert({
      where: { tenantId_storeId: { tenantId, storeId } },
      create: { tenantId, storeId, ...data },
      update: data,
    });

    return {
      tenantId,
      storeId,
      status: 'connected' as const,
      accountLabel: store.name,
    };
  }

  async disconnect(tenantId: string, storeId: string) {
    const row = await this.prisma.blingConnection.findUnique({
      where: { tenantId_storeId: { tenantId, storeId } },
    });
    if (!row) throw new NotFoundException('Conexão Bling não encontrada.');

    await this.prisma.blingConnection.update({
      where: { id: row.id },
      data: {
        status: 'disconnected',
        accessTokenEnc: encryptSecret('disconnected'),
        refreshTokenEnc: encryptSecret('disconnected'),
      },
    });

    return { status: 'disconnected' as const };
  }

  private async getValidAccessToken(
    tenantId: string,
    storeId: string,
  ): Promise<string> {
    this.bling.assertConfigured();
    const row = await this.prisma.blingConnection.findUnique({
      where: { tenantId_storeId: { tenantId, storeId } },
    });
    if (!row || row.status === 'disconnected') {
      throw new UnauthorizedException('Conecte o Bling antes de sincronizar.');
    }

    const skewMs = 60_000;
    if (row.expiresAt.getTime() > Date.now() + skewMs) {
      return decryptSecret(row.accessTokenEnc);
    }

    try {
      const refreshed = await this.bling.refreshToken(
        decryptSecret(row.refreshTokenEnc),
      );
      const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
      await this.prisma.blingConnection.update({
        where: { id: row.id },
        data: {
          accessTokenEnc: encryptSecret(refreshed.access_token),
          refreshTokenEnc: encryptSecret(refreshed.refresh_token),
          expiresAt,
          status: 'connected',
        },
      });
      return refreshed.access_token;
    } catch {
      await this.prisma.blingConnection.update({
        where: { id: row.id },
        data: { status: 'expired' },
      });
      throw new UnauthorizedException(
        'Sessão Bling expirada — reconecte a conta.',
      );
    }
  }

  async sync(tenantId: string, storeId: string): Promise<BlingSyncSummary> {
    const accessToken = await this.getValidAccessToken(tenantId, storeId);
    const warnings: string[] = [];
    let created = 0;
    let updated = 0;
    let stockUpdated = 0;
    let skipped = 0;

    let blingProducts;
    try {
      blingProducts = await this.bling.listProducts(accessToken);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Falha ao listar produtos do Bling.',
      );
    }

    const active = blingProducts.filter(
      (p) => !p.situacao || p.situacao.toUpperCase() === 'A',
    );
    if (active.length === 0) {
      warnings.push('Nenhum produto ativo encontrado no Bling.');
    }

    const ids = active.map((p) => p.id);
    let balances = new Map<number, number>();
    try {
      balances = await this.bling.getStockBalances(accessToken, ids);
    } catch (err) {
      warnings.push(
        err instanceof Error
          ? `Estoques: ${err.message}`
          : 'Não foi possível buscar saldos de estoque.',
      );
    }

    const existing = await this.prisma.product.findMany({
      where: { tenantId, storeId },
    });
    const byBlingId = new Map(
      existing
        .filter((p) => p.blingProductId)
        .map((p) => [p.blingProductId!, p]),
    );
    const bySku = new Map(
      existing
        .filter((p) => p.sku)
        .map((p) => [p.sku!.toUpperCase(), p]),
    );

    for (const bp of active) {
      const blingId = String(bp.id);
      const sku = bp.codigo?.trim() || null;
      const name = (bp.nome || '').trim();
      if (!name) {
        skipped += 1;
        continue;
      }

      const priceCents =
        bp.preco != null && Number.isFinite(bp.preco)
          ? Math.max(0, Math.round(bp.preco * 100))
          : 0;
      const stock = balances.get(bp.id) ?? 0;
      const availability = stock > 0 ? 'available' : 'unavailable';

      const match =
        byBlingId.get(blingId) ||
        (sku ? bySku.get(sku.toUpperCase()) : undefined);

      if (match) {
        const stockChanged = match.stock !== stock;
        await this.prisma.product.update({
          where: { id: match.id },
          data: {
            name,
            sku: sku ?? match.sku,
            blingProductId: blingId,
            priceCents: priceCents || match.priceCents,
            stock,
            availability,
            active: true,
          },
        });
        updated += 1;
        if (stockChanged) stockUpdated += 1;
        byBlingId.set(blingId, match);
        if (sku) bySku.set(sku.toUpperCase(), match);
      } else {
        const createdProduct = await this.prisma.product.create({
          data: {
            tenantId,
            storeId,
            name,
            sku,
            blingProductId: blingId,
            priceCents,
            stock,
            availability,
            active: true,
            sellableByAi: true,
          },
        });
        created += 1;
        stockUpdated += 1;
        byBlingId.set(blingId, createdProduct);
        if (sku) bySku.set(sku.toUpperCase(), createdProduct);
      }
    }

    await this.prisma.blingConnection.update({
      where: { tenantId_storeId: { tenantId, storeId } },
      data: { lastSyncAt: new Date() },
    });

    return { created, updated, stockUpdated, skipped, warnings };
  }
}
