import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CheckoutBrandingInput = {
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  fontFamily?: string | null;
  message?: string | null;
};

export const STORE_RULES_TITLE = 'store-rules';

export type StoreRules = {
  sobreNegocio?: string;
  personalidade?: string;
  instrucoesExtras?: string;
  horaInicio?: string;
  horaFim?: string;
  diasAtivos?: string[];
  followUpDias?: string;
  descontoPadrao?: string;
  margemMaxima?: string;
  maxDescontoUmProduto?: string;
  maxDescontoDoisOuMais?: string;
  aniversario?: boolean;
  cupons?: { id: string; codigo: string; desconto: string; validade: string }[];
};

export type SendWindow = {
  start: string;
  end: string;
  days: string[];
};

const DEFAULT_SEND_WINDOW: SendWindow = {
  start: '09:00',
  end: '20:00',
  days: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
};

const WEEKDAY_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return { module: 'stores', status: 'ok' };
  }

  /** Lojas com pelo menos uma conexão WhatsApp WORKING (motor global Voltou). */
  async listActiveStores() {
    const connections = await this.prisma.whatsAppConnection.findMany({
      where: { status: 'WORKING' },
      select: {
        tenantId: true,
        storeId: true,
        status: true,
        store: {
          select: {
            id: true,
            name: true,
            slug: true,
            timezone: true,
            storeKnowledge: {
              where: { title: STORE_RULES_TITLE },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ tenantId: 'asc' }, { storeId: 'asc' }],
    });

    const byStore = new Map<
      string,
      {
        tenantId: string;
        storeId: string;
        storeName: string;
        storeSlug: string;
        timezone: string;
        whatsappStatus: string;
        hasRules: boolean;
      }
    >();

    for (const conn of connections) {
      const key = `${conn.tenantId}:${conn.storeId}`;
      if (byStore.has(key)) continue;
      byStore.set(key, {
        tenantId: conn.tenantId,
        storeId: conn.storeId,
        storeName: conn.store.name,
        storeSlug: conn.store.slug,
        timezone: conn.store.timezone,
        whatsappStatus: conn.status,
        hasRules: conn.store.storeKnowledge.length > 0,
      });
    }

    return { stores: [...byStore.values()] };
  }

  async getStoreContext(tenantId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, tenantId },
      include: {
        whatsappConnections: {
          orderBy: { updatedAt: 'desc' },
          take: 5,
        },
      },
    });
    if (!store) throw new NotFoundException('Loja não encontrada.');

    const { rules } = await this.getRules(tenantId, storeId);
    const window = this.resolveSendWindow(rules);
    const working = store.whatsappConnections.find((c) => c.status === 'WORKING');
    const primary = working ?? store.whatsappConnections[0] ?? null;

    return {
      tenantId,
      storeId: store.id,
      storeName: store.name,
      storeSlug: store.slug,
      timezone: store.timezone,
      rules,
      whatsapp: {
        connected: Boolean(working),
        status: primary?.status ?? null,
        phoneE164: primary?.phoneE164 ?? null,
      },
      window: {
        ...window,
        open: this.isWithinSendWindow(window, store.timezone),
      },
    };
  }

  resolveSendWindow(rules: StoreRules | null): SendWindow {
    if (!rules) return { ...DEFAULT_SEND_WINDOW };
    return {
      start: rules.horaInicio || DEFAULT_SEND_WINDOW.start,
      end: rules.horaFim || DEFAULT_SEND_WINDOW.end,
      days: rules.diasAtivos?.length
        ? rules.diasAtivos
        : [...DEFAULT_SEND_WINDOW.days],
    };
  }

  isWithinSendWindow(window: SendWindow, timezone: string) {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const hhmm = `${hour}:${minute}`;

    const tzDate = new Date(
      now.toLocaleString('en-US', { timeZone: timezone }),
    );
    const dayLabel = WEEKDAY_LABEL[tzDate.getDay()];

    return (
      window.days.includes(dayLabel) &&
      hhmm >= window.start &&
      hhmm <= window.end
    );
  }

  async getRules(
    tenantId: string,
    storeId: string,
  ): Promise<{ rules: StoreRules | null; updatedAt: string | null }> {
    const row = await this.prisma.storeKnowledge.findFirst({
      where: { tenantId, storeId, title: STORE_RULES_TITLE },
    });
    if (!row) return { rules: null, updatedAt: null };
    try {
      return {
        rules: JSON.parse(row.content) as StoreRules,
        updatedAt: row.updatedAt.toISOString(),
      };
    } catch {
      return { rules: null, updatedAt: null };
    }
  }

  async saveRules(tenantId: string, storeId: string, rules: StoreRules) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, tenantId },
    });
    if (!store) throw new NotFoundException('Loja não encontrada.');

    const existing = await this.prisma.storeKnowledge.findFirst({
      where: { tenantId, storeId, title: STORE_RULES_TITLE },
    });
    const content = JSON.stringify(rules);
    const row = existing
      ? await this.prisma.storeKnowledge.update({
          where: { id: existing.id },
          data: { content },
        })
      : await this.prisma.storeKnowledge.create({
          data: { tenantId, storeId, title: STORE_RULES_TITLE, content },
        });

    return { rules, updatedAt: row.updatedAt.toISOString() };
  }

  async getCheckoutBranding(tenantId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, tenantId },
    });
    if (!store) throw new NotFoundException('Loja não encontrada.');

    return {
      storeId: store.id,
      storeName: store.name,
      logoUrl: store.checkoutLogoUrl,
      primaryColor: store.checkoutPrimaryColor,
      secondaryColor: store.checkoutSecondaryColor,
      fontFamily: store.checkoutFontFamily ?? 'geist',
      message: store.checkoutMessage,
    };
  }

  async updateCheckoutBranding(
    tenantId: string,
    storeId: string,
    input: CheckoutBrandingInput,
  ) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, tenantId },
    });
    if (!store) throw new NotFoundException('Loja não encontrada.');

    const updated = await this.prisma.store.update({
      where: { id: storeId },
      data: {
        ...(input.logoUrl !== undefined
          ? { checkoutLogoUrl: input.logoUrl }
          : {}),
        ...(input.primaryColor !== undefined
          ? { checkoutPrimaryColor: input.primaryColor }
          : {}),
        ...(input.secondaryColor !== undefined
          ? { checkoutSecondaryColor: input.secondaryColor }
          : {}),
        ...(input.fontFamily !== undefined
          ? { checkoutFontFamily: input.fontFamily }
          : {}),
        ...(input.message !== undefined
          ? { checkoutMessage: input.message }
          : {}),
      },
    });

    return {
      storeId: updated.id,
      storeName: updated.name,
      logoUrl: updated.checkoutLogoUrl,
      primaryColor: updated.checkoutPrimaryColor,
      secondaryColor: updated.checkoutSecondaryColor,
      fontFamily: updated.checkoutFontFamily ?? 'geist',
      message: updated.checkoutMessage,
    };
  }
}
