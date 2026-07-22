import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateSaleInput } from '../shared/schemas';

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return { module: 'sales', status: 'ok' };
  }

  async list(tenantId: string, storeId?: string, take = 100) {
    return this.prisma.sale.findMany({
      where: { tenantId, ...(storeId ? { storeId } : {}) },
      orderBy: { soldAt: 'desc' },
      take,
      include: {
        product: { select: { id: true, name: true, category: true } },
        customer: {
          select: { id: true, displayName: true, phoneMasked: true },
        },
      },
    });
  }

  async create(input: CreateSaleInput) {
    const [customer, product] = await Promise.all([
      this.prisma.customer.findFirst({
        where: {
          id: input.customerId,
          tenantId: input.tenantId,
          storeId: input.storeId,
        },
      }),
      this.prisma.product.findFirst({
        where: {
          id: input.productId,
          tenantId: input.tenantId,
          storeId: input.storeId,
        },
      }),
    ]);

    if (!customer) throw new BadRequestException('Cliente não encontrado.');
    if (!product) throw new BadRequestException('Produto não encontrado.');

    const sale = await this.prisma.sale.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        customerId: input.customerId,
        productId: input.productId,
        amountCents: input.amountCents,
        currency: input.currency,
        source: input.source,
      },
    });

    await this.prisma.customerEvent.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        customerId: input.customerId,
        type: 'sale',
        title: `Compra: ${product.name}`,
        detail: `R$ ${(input.amountCents / 100).toFixed(2).replace('.', ',')} · ${input.source}`,
        metadata: JSON.stringify({ saleId: sale.id }),
      },
    });

    return sale;
  }
}
