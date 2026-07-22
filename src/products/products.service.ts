import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateProductInput,
  UpdateProductInput,
} from '../shared/schemas';
import {
  DEFAULT_MAX_DISCOUNT_BPS,
  effectiveMaxDiscountBps,
  priceFloorCents,
} from './pricing.util';

const AI_CONFIG_TITLE = 'ai-config';

type AiConfig = {
  defaultMaxDiscountBps: number;
};

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return { module: 'products', status: 'ok' };
  }

  private async getAiConfig(
    tenantId: string,
    storeId: string,
  ): Promise<AiConfig> {
    const row = await this.prisma.storeKnowledge.findFirst({
      where: { tenantId, storeId, title: AI_CONFIG_TITLE },
    });
    if (!row) return { defaultMaxDiscountBps: DEFAULT_MAX_DISCOUNT_BPS };
    try {
      const parsed = JSON.parse(row.content) as Partial<AiConfig>;
      return {
        defaultMaxDiscountBps:
          parsed.defaultMaxDiscountBps ?? DEFAULT_MAX_DISCOUNT_BPS,
      };
    } catch {
      return { defaultMaxDiscountBps: DEFAULT_MAX_DISCOUNT_BPS };
    }
  }

  async setAiConfig(
    tenantId: string,
    storeId: string,
    config: AiConfig,
  ): Promise<AiConfig> {
    const existing = await this.prisma.storeKnowledge.findFirst({
      where: { tenantId, storeId, title: AI_CONFIG_TITLE },
    });
    if (existing) {
      await this.prisma.storeKnowledge.update({
        where: { id: existing.id },
        data: { content: JSON.stringify(config) },
      });
    } else {
      await this.prisma.storeKnowledge.create({
        data: {
          tenantId,
          storeId,
          title: AI_CONFIG_TITLE,
          content: JSON.stringify(config),
        },
      });
    }
    return config;
  }

  private async decorate(
    tenantId: string,
    storeId: string,
    products: Awaited<ReturnType<PrismaService['product']['findMany']>>,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { commissionRateBps: true },
    });
    const commissionBps = tenant?.commissionRateBps ?? 500;
    const config = await this.getAiConfig(tenantId, storeId);

    return products.map((p) => ({
      ...p,
      priceFloorCents: priceFloorCents(
        p,
        commissionBps,
        config.defaultMaxDiscountBps,
      ),
      effectiveMaxDiscountBps: effectiveMaxDiscountBps(
        p,
        commissionBps,
        config.defaultMaxDiscountBps,
      ),
    }));
  }

  async list(tenantId: string, storeId: string) {
    const products = await this.prisma.product.findMany({
      where: { tenantId, storeId },
      orderBy: { createdAt: 'desc' },
    });
    return this.decorate(tenantId, storeId, products);
  }

  /** Só o que a IA pode oferecer: ativo, disponível e liberado pelo lojista. */
  async getSellableProducts(tenantId: string, storeId: string) {
    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        storeId,
        active: true,
        availability: 'available',
        sellableByAi: true,
      },
      orderBy: { name: 'asc' },
    });
    return this.decorate(tenantId, storeId, products);
  }

  async create(input: CreateProductInput) {
    const store = await this.prisma.store.findFirst({
      where: { id: input.storeId, tenantId: input.tenantId },
    });
    if (!store) {
      throw new BadRequestException('Loja não encontrada para este tenant.');
    }

    const product = await this.prisma.product.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        name: input.name,
        sku: input.sku ?? null,
        category: input.category ?? null,
        priceCents: input.priceCents,
        costCents: input.costCents ?? null,
        maxDiscountBps: input.maxDiscountBps ?? null,
        availability: input.availability ?? 'available',
        sellableByAi: input.sellableByAi ?? true,
        stock: input.stock ?? 0,
        active: input.active ?? true,
      },
    });

    const [decorated] = await this.decorate(input.tenantId, input.storeId, [
      product,
    ]);
    return decorated;
  }

  async update(tenantId: string, productId: string, input: UpdateProductInput) {
    const existing = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });
    if (!existing) throw new NotFoundException('Produto não encontrado.');

    const product = await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(input.name != null ? { name: input.name } : {}),
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.priceCents != null ? { priceCents: input.priceCents } : {}),
        ...(input.costCents !== undefined ? { costCents: input.costCents } : {}),
        ...(input.maxDiscountBps !== undefined
          ? { maxDiscountBps: input.maxDiscountBps }
          : {}),
        ...(input.availability != null
          ? { availability: input.availability }
          : {}),
        ...(input.sellableByAi != null
          ? { sellableByAi: input.sellableByAi }
          : {}),
        ...(input.stock != null ? { stock: input.stock } : {}),
        ...(input.active != null ? { active: input.active } : {}),
      },
    });

    const [decorated] = await this.decorate(tenantId, existing.storeId, [
      product,
    ]);
    return decorated;
  }
}
