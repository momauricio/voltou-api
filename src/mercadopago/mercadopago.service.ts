import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  decryptSecret,
  encryptSecret,
  signOAuthState,
  verifyOAuthState,
} from '../common/secret.util';
import {
  CreatePaymentLinkInput,
  CreatePaymentLinkResult,
  PaymentProvider,
} from '../checkout/payment-provider';
import { MercadoPagoClient, type MpTokenResponse } from './mercadopago.client';

export type MpConnectionView = {
  connected: boolean;
  status: string | null;
  accountLabel: string | null;
  mpUserId: string | null;
  configured: boolean;
};

@Injectable()
export class MercadoPagoService implements PaymentProvider {
  readonly id = 'mercadopago' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mp: MercadoPagoClient,
  ) {}

  health() {
    return {
      module: 'mercadopago',
      status: 'ok',
      configured: this.mp.isConfigured(),
    };
  }

  async isConnected(tenantId: string, storeId: string): Promise<boolean> {
    const row = await this.prisma.mercadoPagoConnection.findUnique({
      where: { tenantId_storeId: { tenantId, storeId } },
    });
    return Boolean(row && row.status === 'connected');
  }

  async getAuthorizeUrl(tenantId: string, storeId: string) {
    this.mp.assertConfigured();
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, tenantId },
    });
    if (!store) {
      throw new BadRequestException('Loja não encontrada para este tenant.');
    }
    const state = signOAuthState(tenantId, storeId);
    return { url: this.mp.buildAuthorizeUrl(state), state };
  }

  async getConnection(
    tenantId: string,
    storeId: string,
  ): Promise<MpConnectionView> {
    const configured = this.mp.isConfigured();
    const row = await this.prisma.mercadoPagoConnection.findUnique({
      where: { tenantId_storeId: { tenantId, storeId } },
    });
    if (!row || row.status === 'disconnected') {
      return {
        connected: false,
        status: row?.status ?? null,
        accountLabel: null,
        mpUserId: null,
        configured,
      };
    }
    return {
      connected: row.status === 'connected',
      status: row.status,
      accountLabel: row.accountLabel,
      mpUserId: row.mpUserId,
      configured,
    };
  }

  async completeOAuth(code: string, state: string) {
    this.mp.assertConfigured();
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

    let tokens: MpTokenResponse;
    try {
      tokens = await this.mp.exchangeCode(code);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error
          ? err.message
          : 'Falha ao trocar código OAuth do Mercado Pago.',
      );
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const data = {
      accessTokenEnc: encryptSecret(tokens.access_token),
      refreshTokenEnc: encryptSecret(tokens.refresh_token),
      expiresAt,
      status: 'connected',
      mpUserId: tokens.user_id != null ? String(tokens.user_id) : null,
      accountLabel: store.name,
    };

    await this.prisma.mercadoPagoConnection.upsert({
      where: { tenantId_storeId: { tenantId, storeId } },
      create: { tenantId, storeId, ...data },
      update: data,
    });

    await this.prisma.store.update({
      where: { id: storeId },
      data: { preferredCheckoutProvider: 'mercadopago' },
    });

    return {
      tenantId,
      storeId,
      status: 'connected' as const,
      accountLabel: store.name,
    };
  }

  async disconnect(tenantId: string, storeId: string) {
    const row = await this.prisma.mercadoPagoConnection.findUnique({
      where: { tenantId_storeId: { tenantId, storeId } },
    });
    if (!row) throw new NotFoundException('Conexão Mercado Pago não encontrada.');

    await this.prisma.mercadoPagoConnection.update({
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
    this.mp.assertConfigured();
    const row = await this.prisma.mercadoPagoConnection.findUnique({
      where: { tenantId_storeId: { tenantId, storeId } },
    });
    if (!row || row.status === 'disconnected') {
      throw new UnauthorizedException(
        'Conecte o Mercado Pago antes de gerar cobranças.',
      );
    }

    const skewMs = 60_000;
    if (row.expiresAt.getTime() > Date.now() + skewMs) {
      return decryptSecret(row.accessTokenEnc);
    }

    try {
      const refreshed = await this.mp.refreshToken(
        decryptSecret(row.refreshTokenEnc),
      );
      const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
      await this.prisma.mercadoPagoConnection.update({
        where: { id: row.id },
        data: {
          accessTokenEnc: encryptSecret(refreshed.access_token),
          refreshTokenEnc: encryptSecret(refreshed.refresh_token),
          expiresAt,
          status: 'connected',
          mpUserId:
            refreshed.user_id != null
              ? String(refreshed.user_id)
              : row.mpUserId,
        },
      });
      return refreshed.access_token;
    } catch {
      await this.prisma.mercadoPagoConnection.update({
        where: { id: row.id },
        data: { status: 'expired' },
      });
      throw new UnauthorizedException(
        'Sessão Mercado Pago expirada — reconecte a conta.',
      );
    }
  }

  async createPaymentLink(
    input: CreatePaymentLinkInput,
  ): Promise<CreatePaymentLinkResult> {
    const accessToken = await this.getValidAccessToken(
      input.tenantId,
      input.storeId,
    );
    const webUrl = process.env.WEB_URL ?? 'http://localhost:3000';
    const apiUrl =
      process.env.API_PUBLIC_URL ??
      process.env.WEB_URL?.replace(':3000', ':3001') ??
      'http://localhost:3001';

    const slug = input.storeSlug;
    const coupon = input.couponCode;
    const offerBase =
      slug && coupon
        ? `${webUrl}/loja/${slug}/${coupon}`
        : `${webUrl}/p/${input.publicToken}`;
    const successUrl =
      slug && coupon
        ? `${webUrl}/obrigado/${slug}/${coupon}`
        : `${offerBase}?status=success`;
    const pendingUrl =
      slug && coupon
        ? `${webUrl}/aguardando/${slug}/${coupon}`
        : `${offerBase}?status=pending`;
    const failureUrl = offerBase;

    const preference = await this.mp.createPreference(accessToken, {
      title: input.title,
      amountCents: input.amountCents,
      marketplaceFeeCents: input.commissionCents,
      externalReference: input.checkoutId,
      notificationUrl: `${apiUrl}/mercadopago/webhook`,
      successUrl,
      pendingUrl,
      failureUrl,
      payerEmail: input.payerEmail,
      items: input.items,
    });

    return {
      initPoint: preference.init_point,
      providerRef: preference.id,
    };
  }

  /**
   * Webhook: MP envia topic=payment&id=... ou body com data.id.
   * Sempre grava WebhookLog; retorna checkoutId quando payment approved.
   */
  async handleWebhook(
    query: Record<string, string>,
    body: unknown,
    headers?: Record<string, string | string[] | undefined>,
  ) {
    const log = await this.prisma.webhookLog.create({
      data: {
        provider: 'mercadopago',
        payload: JSON.stringify({ query, body }),
        headers: headers ? JSON.stringify(headers) : null,
      },
    });

    try {
      const secret = process.env.MP_WEBHOOK_SECRET?.trim();
      if (secret) {
        const signatureOk = this.verifyWebhookSignature(
          secret,
          query,
          body,
          headers,
        );
        if (!signatureOk) {
          await this.prisma.webhookLog.update({
            where: { id: log.id },
            data: {
              processedOk: false,
              error: 'assinatura inválida',
            },
          });
          // Ainda retornamos 200 no controller; aqui só registramos.
          return { ignored: true, reason: 'assinatura inválida' };
        }
      }

      const paymentId =
        query['data.id'] ||
        query.id ||
        (typeof body === 'object' &&
        body &&
        'data' in body &&
        typeof (body as { data?: { id?: string } }).data?.id !== 'undefined'
          ? String((body as { data: { id: string | number } }).data.id)
          : null);

      const topic = query.topic || query.type || '';
      if (!paymentId) {
        await this.prisma.webhookLog.update({
          where: { id: log.id },
          data: { processedOk: true, error: 'sem payment id' },
        });
        return { ignored: true, reason: 'sem payment id' };
      }

      if (
        topic &&
        !['payment', 'payments'].includes(String(topic).toLowerCase())
      ) {
        await this.prisma.webhookLog.update({
          where: { id: log.id },
          data: { processedOk: true, error: `topic=${topic}` },
        });
        return { ignored: true, reason: `topic=${topic}` };
      }

      // Prefer: fetch payment using connected stores until external_reference matches a checkout
      const connections = await this.prisma.mercadoPagoConnection.findMany({
        where: { status: 'connected' },
        take: 50,
      });

      let payment: Awaited<ReturnType<MercadoPagoClient['getPayment']>> | null =
        null;

      for (const conn of connections) {
        try {
          const token = await this.getValidAccessToken(
            conn.tenantId,
            conn.storeId,
          );
          const candidate = await this.mp.getPayment(token, String(paymentId));
          if (candidate?.external_reference) {
            const checkout = await this.prisma.checkout.findFirst({
              where: {
                id: candidate.external_reference,
                tenantId: conn.tenantId,
                storeId: conn.storeId,
              },
              select: { id: true },
            });
            if (checkout) {
              payment = candidate;
              break;
            }
          }
          // keep first successful payment fetch as fallback
          if (!payment) payment = candidate;
        } catch {
          // tenta próxima loja
        }
      }

      if (!payment?.external_reference) {
        await this.prisma.webhookLog.update({
          where: { id: log.id },
          data: {
            processedOk: true,
            error: 'pagamento não encontrado',
          },
        });
        return { ignored: true, reason: 'pagamento não encontrado' };
      }

      if (payment.status !== 'approved') {
        await this.prisma.webhookLog.update({
          where: { id: log.id },
          data: {
            processedOk: true,
            error: `status=${payment.status}`,
          },
        });
        return {
          ignored: true,
          reason: `status=${payment.status}`,
          checkoutId: payment.external_reference,
          paymentId: String(payment.id),
        };
      }

      // Confirm checkout exists by id (external_reference)
      const checkout = await this.prisma.checkout.findUnique({
        where: { id: payment.external_reference },
        select: { id: true },
      });
      if (!checkout) {
        await this.prisma.webhookLog.update({
          where: { id: log.id },
          data: {
            processedOk: false,
            error: 'checkout não encontrado',
          },
        });
        return {
          ignored: true,
          reason: 'checkout não encontrado',
          paymentId: String(payment.id),
        };
      }

      await this.prisma.webhookLog.update({
        where: { id: log.id },
        data: { processedOk: true },
      });

      return {
        checkoutId: checkout.id,
        status: payment.status,
        paymentId: String(payment.id),
      };
    } catch (err) {
      await this.prisma.webhookLog.update({
        where: { id: log.id },
        data: {
          processedOk: false,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return {
        ignored: true,
        reason: err instanceof Error ? err.message : 'erro interno',
      };
    }
  }

  private verifyWebhookSignature(
    secret: string,
    query: Record<string, string>,
    body: unknown,
    headers?: Record<string, string | string[] | undefined>,
  ): boolean {
    try {
      const rawSig = headerValue(headers, 'x-signature');
      const requestId = headerValue(headers, 'x-request-id');
      if (!rawSig) return false;

      const parts = Object.fromEntries(
        rawSig.split(',').map((p) => {
          const [k, v] = p.split('=');
          return [k?.trim(), v?.trim()];
        }),
      );
      const ts = parts.ts;
      const hash = parts.v1;
      if (!ts || !hash) return false;

      const dataId =
        query['data.id'] ||
        (typeof body === 'object' &&
        body &&
        'data' in body &&
        (body as { data?: { id?: string | number } }).data?.id != null
          ? String((body as { data: { id: string | number } }).data.id)
          : '');

      const manifest = `id:${dataId};request-id:${requestId ?? ''};ts:${ts};`;
      const expected = createHmac('sha256', secret)
        .update(manifest)
        .digest('hex');

      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(hash, 'utf8');
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (!key) return undefined;
  const v = headers[key];
  return Array.isArray(v) ? v[0] : v;
}
