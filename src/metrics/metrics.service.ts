import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SegmentsService } from '../customers/segments.service';

const RECOVERED_SOURCES = ['checkout_link', 'ai'];
const DAY_MS = 24 * 60 * 60 * 1000;

export type DashboardMetrics = {
  range: { from: string; to: string };
  kpis: {
    recoveredRevenueCents: number;
    /** Soma do que fica com o lojista (amount - commission) nas vendas recuperadas */
    merchantRecoveredCents: number;
    commissionCents: number;
    salesConfirmed: number;
    /** paid checkouts / checkouts com pelo menos 1 clique */
    clickToPurchaseRate: number;
    messagesSent: number;
    interests: number;
    returnedCustomers: number;
    returnRate: number;
    readyToContact: number;
    pendingRevenueCents: number;
    inactiveCustomers: number;
  };
  funnel: {
    contacted: number;
    interested: number;
    checkoutsSent: number;
    checkoutsPaid: number;
    checkoutsClicked: number;
  };
  series: {
    label: string;
    receitaCents: number;
    envios: number;
    retornos: number;
  }[];
  topProducts: {
    productId: string;
    nome: string;
    categoria: string;
    contatos: number;
    interesses: number;
    retornos: number;
    receitaCents: number;
  }[];
  categories: {
    categoria: string;
    contatos: number;
    interesses: number;
    retornos: number;
    receitaCents: number;
    taxaRetorno: number;
  }[];
  recentSales: {
    id: string;
    customerName: string;
    productName: string;
    amountCents: number;
    merchantCents: number;
    commissionCents: number;
    status: string;
    soldAt: string;
    source: string;
  }[];
};

@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly segments: SegmentsService,
  ) {}

  async dashboard(
    tenantId: string,
    storeId: string,
    fromInput?: string,
    toInput?: string,
  ): Promise<DashboardMetrics> {
    const to = toInput ? endOfDay(new Date(toInput)) : endOfDay(new Date());
    const from = fromInput
      ? startOfDay(new Date(fromInput))
      : startOfDay(new Date(to.getTime() - 29 * DAY_MS));

    const [sales, outreach, interests, checkouts, segmentsResult] =
      await Promise.all([
        this.prisma.sale.findMany({
          where: { tenantId, storeId, soldAt: { gte: from, lte: to } },
          include: { product: { select: { id: true, name: true, category: true } } },
        }),
        this.prisma.outreachMessage.findMany({
          where: {
            tenantId,
            storeId,
            status: 'sent',
            sentAt: { gte: from, lte: to },
          },
          select: {
            id: true,
            customerId: true,
            sentAt: true,
            repliedAt: true,
          },
        }),
        this.prisma.customerInterest.findMany({
          where: { tenantId, storeId, interestedAt: { gte: from, lte: to } },
          include: { product: { select: { id: true, name: true, category: true } } },
        }),
        this.prisma.checkout.findMany({
          where: { tenantId, storeId, createdAt: { gte: from, lte: to } },
          include: { product: { select: { id: true, name: true, category: true } } },
        }),
        this.segments.compute(tenantId, storeId),
      ]);

    const recovered = sales.filter((s) => RECOVERED_SOURCES.includes(s.source));
    const recoveredRevenueCents = recovered.reduce(
      (sum, s) => sum + s.amountCents,
      0,
    );
    const commissionCents = recovered.reduce(
      (sum, s) => sum + s.commissionCents,
      0,
    );
    const merchantRecoveredCents = recoveredRevenueCents - commissionCents;
    const salesConfirmed = recovered.length;
    const checkoutsClicked = checkouts.filter((c) => c.clickCount > 0 || c.clickedAt).length;
    const checkoutsPaid = checkouts.filter((c) => c.status === 'paid').length;
    const clickToPurchaseRate =
      checkoutsClicked > 0 ? checkoutsPaid / checkoutsClicked : 0;
    // "Retornaram" = responderam o disparo no WhatsApp (não compra)
    const repliedOutreach = outreach.filter((m) => m.repliedAt != null);
    const returnedCustomers = new Set(repliedOutreach.map((m) => m.customerId))
      .size;
    const contactedCustomers = new Set(outreach.map((m) => m.customerId)).size;

    const pendingCheckouts = await this.prisma.checkout.findMany({
      where: {
        tenantId,
        storeId,
        status: 'pending',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { amountCents: true },
    });
    const openInterests = await this.prisma.customerInterest.findMany({
      where: { tenantId, storeId, status: 'open' },
      select: { productPriceCents: true },
    });
    const pendingRevenueCents =
      pendingCheckouts.reduce((s, c) => s + c.amountCents, 0) +
      openInterests.reduce((s, i) => s + (i.productPriceCents ?? 0), 0);

    // --- Série temporal (dia a dia até 31 dias; senão por semana) ---
    const totalDays = Math.max(
      1,
      Math.round((to.getTime() - from.getTime()) / DAY_MS),
    );
    const byWeek = totalDays > 31;
    const bucketMs = byWeek ? 7 * DAY_MS : DAY_MS;
    const bucketCount = Math.min(Math.ceil(totalDays / (byWeek ? 7 : 1)), 60);

    const series = Array.from({ length: bucketCount }, (_, i) => {
      const bucketStart = new Date(from.getTime() + i * bucketMs);
      const bucketEnd = new Date(
        Math.min(bucketStart.getTime() + bucketMs, to.getTime() + 1),
      );
      const inBucket = (d: Date | null) =>
        d != null && d >= bucketStart && d < bucketEnd;

      const receitaCents = recovered
        .filter((s) => inBucket(s.soldAt))
        .reduce((sum, s) => sum + s.amountCents, 0);
      const envios = outreach.filter((m) => inBucket(m.sentAt)).length;
      const retornos = outreach.filter(
        (m) => m.repliedAt != null && inBucket(m.repliedAt),
      ).length;

      const label = bucketStart.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      });

      return { label, receitaCents, envios, retornos };
    });

    // --- Agregação por produto ---
    type ProdAgg = {
      productId: string;
      nome: string;
      categoria: string;
      contatos: number;
      interesses: number;
      retornos: number;
      receitaCents: number;
    };
    const prodMap = new Map<string, ProdAgg>();
    const getProd = (
      id: string | null,
      name: string,
      category: string | null,
    ): ProdAgg => {
      const key = id ?? `name:${name}`;
      let row = prodMap.get(key);
      if (!row) {
        row = {
          productId: key,
          nome: name,
          categoria: category ?? 'Geral',
          contatos: 0,
          interesses: 0,
          retornos: 0,
          receitaCents: 0,
        };
        prodMap.set(key, row);
      }
      return row;
    };

    for (const i of interests) {
      getProd(
        i.productId,
        i.product?.name ?? i.productNameSnapshot,
        i.product?.category ?? null,
      ).interesses += 1;
    }
    for (const c of checkouts) {
      getProd(
        c.productId,
        c.product?.name ?? c.productNameSnapshot,
        c.product?.category ?? null,
      ).contatos += 1;
    }
    for (const s of recovered) {
      const row = getProd(s.productId, s.product.name, s.product.category);
      row.retornos += 1;
      row.receitaCents += s.amountCents;
    }

    const topProducts = [...prodMap.values()].sort((a, b) => {
      if (b.receitaCents !== a.receitaCents)
        return b.receitaCents - a.receitaCents;
      return b.interesses - a.interesses;
    });

    // --- Agregação por categoria ---
    const catMap = new Map<
      string,
      { contatos: number; interesses: number; retornos: number; receitaCents: number }
    >();
    for (const p of topProducts) {
      const row = catMap.get(p.categoria) ?? {
        contatos: 0,
        interesses: 0,
        retornos: 0,
        receitaCents: 0,
      };
      row.contatos += p.contatos;
      row.interesses += p.interesses;
      row.retornos += p.retornos;
      row.receitaCents += p.receitaCents;
      catMap.set(p.categoria, row);
    }
    const categories = [...catMap.entries()]
      .map(([categoria, row]) => ({
        categoria,
        ...row,
        taxaRetorno: row.contatos > 0 ? row.retornos / row.contatos : 0,
      }))
      .sort((a, b) => b.receitaCents - a.receitaCents);

    const inactiveCustomers =
      segmentsResult.segments.find((s) => s.id === 'inativos')?.count ?? 0;

    const salesWithCustomers = await this.prisma.sale.findMany({
      where: {
        tenantId,
        storeId,
        soldAt: { gte: from, lte: to },
        source: { in: RECOVERED_SOURCES },
      },
      orderBy: { soldAt: 'desc' },
      take: 20,
      include: {
        product: { select: { name: true } },
        customer: { select: { displayName: true } },
      },
    });

    const recentSalesList = salesWithCustomers.map((s) => ({
      id: s.id,
      customerName: s.customer.displayName,
      productName: s.product.name,
      amountCents: s.amountCents,
      merchantCents: s.amountCents - s.commissionCents,
      commissionCents: s.commissionCents,
      status: s.status,
      soldAt: s.soldAt.toISOString(),
      source: s.source,
    }));

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      kpis: {
        recoveredRevenueCents,
        merchantRecoveredCents,
        commissionCents,
        salesConfirmed,
        clickToPurchaseRate,
        messagesSent: outreach.length,
        interests: interests.length,
        returnedCustomers,
        returnRate:
          outreach.length > 0 ? repliedOutreach.length / outreach.length : 0,
        readyToContact: segmentsResult.readyToContact,
        pendingRevenueCents,
        inactiveCustomers,
      },
      funnel: {
        contacted: contactedCustomers,
        interested: interests.length,
        checkoutsSent: checkouts.length,
        checkoutsPaid,
        checkoutsClicked,
      },
      series,
      topProducts,
      categories,
      recentSales: recentSalesList,
    };
  }
}

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy;
}
