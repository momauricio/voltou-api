import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { STORE_RULES_TITLE } from '../stores/stores.service';

export type SegmentId =
  | 'checkout_pendente'
  | 'interesse_aberto'
  | 'inativos'
  | 'sem_compra';

export type SegmentCustomer = {
  customerId: string;
  displayName: string;
  phoneMasked: string | null;
  segment: SegmentId;
  reason: string;
  productName: string | null;
  lastSaleAt: string | null;
  totalSpentCents: number;
  purchases: number;
  optedOut: boolean;
  readyToContact: boolean;
};

export type SegmentsResult = {
  followUpDays: number;
  segments: {
    id: SegmentId;
    label: string;
    description: string;
    count: number;
  }[];
  customers: SegmentCustomer[];
  readyToContact: number;
};

export const SEGMENT_META: Record<
  SegmentId,
  { label: string; description: string }
> = {
  checkout_pendente: {
    label: 'Checkout pendente',
    description: 'Recebeu link de pagamento e ainda não pagou.',
  },
  interesse_aberto: {
    label: 'Interesse aberto',
    description: 'Demonstrou interesse em um produto e não comprou.',
  },
  inativos: {
    label: 'Sumidos',
    description: 'Compraram no passado e não voltam há tempo demais.',
  },
  sem_compra: {
    label: 'Nunca compraram',
    description: 'Estão na base mas nunca fecharam uma compra.',
  },
};

const RECENT_OUTREACH_DAYS = 7;

@Injectable()
export class SegmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async followUpDays(tenantId: string, storeId: string) {
    const row = await this.prisma.storeKnowledge.findFirst({
      where: { tenantId, storeId, title: STORE_RULES_TITLE },
    });
    if (!row) return 60;
    try {
      const parsed = JSON.parse(row.content) as { followUpDias?: string };
      const days = Number(parsed.followUpDias);
      return Number.isFinite(days) && days > 0 ? days : 60;
    } catch {
      return 60;
    }
  }

  async compute(tenantId: string, storeId: string): Promise<SegmentsResult> {
    const followUpDays = await this.followUpDays(tenantId, storeId);
    const now = Date.now();
    const inactiveCutoff = new Date(now - followUpDays * 24 * 60 * 60 * 1000);
    const recentOutreachCutoff = new Date(
      now - RECENT_OUTREACH_DAYS * 24 * 60 * 60 * 1000,
    );

    const customers = await this.prisma.customer.findMany({
      where: { tenantId, storeId },
      include: {
        sales: { orderBy: { soldAt: 'desc' } },
        customerInterests: {
          where: { status: 'open' },
          orderBy: { interestedAt: 'desc' },
          take: 1,
        },
        checkouts: {
          where: {
            status: 'pending',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        outreachMessages: {
          where: {
            OR: [
              { status: { in: ['pending_approval', 'approved', 'queued'] } },
              { sentAt: { gt: recentOutreachCutoff } },
            ],
          },
          take: 1,
        },
      },
    });

    const rows: SegmentCustomer[] = [];

    for (const c of customers) {
      const lastSale = c.sales[0] ?? null;
      const openInterest = c.customerInterests[0] ?? null;
      const pendingCheckout = c.checkouts[0] ?? null;
      const totalSpentCents = c.sales.reduce((s, v) => s + v.amountCents, 0);

      let segment: SegmentId | null = null;
      let reason = '';
      let productName: string | null = null;

      if (pendingCheckout) {
        segment = 'checkout_pendente';
        productName = pendingCheckout.productNameSnapshot;
        reason = `Link de ${pendingCheckout.productNameSnapshot} aguardando pagamento`;
      } else if (openInterest) {
        segment = 'interesse_aberto';
        productName = openInterest.productNameSnapshot;
        reason = `Interesse em ${openInterest.productNameSnapshot} sem compra`;
      } else if (lastSale && lastSale.soldAt < inactiveCutoff) {
        segment = 'inativos';
        productName = null;
        const days = Math.floor(
          (now - lastSale.soldAt.getTime()) / (24 * 60 * 60 * 1000),
        );
        reason = `Última compra há ${days} dias`;
      } else if (!lastSale) {
        segment = 'sem_compra';
        reason = 'Nunca comprou';
      }

      if (!segment) continue;

      const optedOut = c.optedOutAt != null;
      const hasRecentOrQueuedOutreach = c.outreachMessages.length > 0;

      rows.push({
        customerId: c.id,
        displayName: c.displayName,
        phoneMasked: c.phoneMasked,
        segment,
        reason,
        productName,
        lastSaleAt: lastSale ? lastSale.soldAt.toISOString() : null,
        totalSpentCents,
        purchases: c.sales.length,
        optedOut,
        readyToContact: !optedOut && !hasRecentOrQueuedOutreach,
      });
    }

    const segments = (Object.keys(SEGMENT_META) as SegmentId[]).map((id) => ({
      id,
      label: SEGMENT_META[id].label,
      description: SEGMENT_META[id].description,
      count: rows.filter((r) => r.segment === id).length,
    }));

    return {
      followUpDays,
      segments,
      customers: rows,
      readyToContact: rows.filter((r) => r.readyToContact).length,
    };
  }

  /** Clientes elegíveis para uma campanha em um segmento (respeita opt-out e fila). */
  async eligibleForSegment(
    tenantId: string,
    storeId: string,
    segment: SegmentId | 'todos',
  ) {
    const result = await this.compute(tenantId, storeId);
    return result.customers.filter(
      (c) =>
        c.readyToContact && (segment === 'todos' || c.segment === segment),
    );
  }
}
