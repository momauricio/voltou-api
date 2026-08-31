import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCustomerInput,
  CreateInterestInput,
} from '../shared/schemas';
import {
  encryptPhone,
  hashPhone,
  maskPhone,
  normalizePhoneBr,
} from '../common/phone.util';
import { CUSTOMER_EVENT_CONTACTED } from './customer-events';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return { module: 'customers', status: 'ok' };
  }

  async list(tenantId: string, storeId?: string) {
    const rows = await this.prisma.customer.findMany({
      where: {
        tenantId,
        ...(storeId ? { storeId } : {}),
      },
      include: {
        customerInterests: {
          where: { status: 'open' },
          orderBy: { interestedAt: 'desc' },
          take: 3,
        },
        sales: {
          orderBy: { soldAt: 'desc' },
          take: 1,
          include: { product: true },
        },
        checkouts: {
          where: { status: 'pending' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        outreachMessages: {
          where: { status: 'sent' },
          select: { id: true, repliedAt: true, sentAt: true },
          orderBy: { sentAt: 'desc' },
          take: 10,
        },
        customerEvents: {
          where: { type: CUSTOMER_EVENT_CONTACTED },
          orderBy: { occurredAt: 'desc' },
          take: 1,
          select: { occurredAt: true },
        },
        _count: {
          select: {
            sales: true,
            customerInterests: true,
            checkouts: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(({ customerEvents, ...customer }) => ({
      ...customer,
      lastContactedAt: customerEvents[0]?.occurredAt ?? null,
    }));
  }

  async getDetail(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      include: {
        customerInterests: {
          orderBy: { interestedAt: 'desc' },
          include: { product: true },
        },
        sales: {
          orderBy: { soldAt: 'desc' },
          include: { product: true },
        },
        checkouts: {
          orderBy: { createdAt: 'desc' },
        },
        customerEvents: {
          orderBy: { occurredAt: 'desc' },
          take: 50,
        },
        outreachMessages: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');
    const lastContactedAt =
      customer.customerEvents.find((e) => e.type === CUSTOMER_EVENT_CONTACTED)
        ?.occurredAt ?? null;
    return { ...customer, lastContactedAt };
  }

  async create(input: CreateCustomerInput) {
    const phone = normalizePhoneBr(input.phone);
    if (phone.replace(/\D/g, '').length < 10) {
      throw new BadRequestException('WhatsApp/telefone inválido.');
    }

    const phoneHash = hashPhone(phone);
    const existing = await this.prisma.customer.findFirst({
      where: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        phoneHash,
      },
    });
    if (existing) {
      throw new BadRequestException('Já existe cliente com este WhatsApp.');
    }

    let productName: string | undefined = input.interestProductName;
    let productPrice: number | undefined;
    if (input.interestProductId) {
      const product = await this.prisma.product.findFirst({
        where: {
          id: input.interestProductId,
          tenantId: input.tenantId,
          storeId: input.storeId,
        },
      });
      if (!product) throw new BadRequestException('Produto não encontrado.');
      productName = product.name;
      productPrice = product.priceCents;
    }

    const customer = await this.prisma.customer.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        displayName: input.displayName,
        phoneHash,
        phoneEnc: encryptPhone(phone),
        phoneMasked: maskPhone(phone),
        notes: input.notes,
      },
    });

    await this.prisma.customerEvent.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        customerId: customer.id,
        type: 'note',
        title: 'Cliente cadastrado',
        detail: 'Cadastro manual no painel',
      },
    });

    if (productName) {
      await this.addInterest({
        tenantId: input.tenantId,
        storeId: input.storeId,
        customerId: customer.id,
        productId: input.interestProductId,
        productName,
        productPriceCents: productPrice,
        source: 'walk_in',
        notes: input.interestNotes,
      });
    }

    return this.getDetail(input.tenantId, customer.id);
  }

  async setOptOut(tenantId: string, customerId: string, optedOut: boolean) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: { optedOutAt: optedOut ? new Date() : null },
    });

    await this.prisma.customerEvent.create({
      data: {
        tenantId,
        storeId: customer.storeId,
        customerId,
        type: 'note',
        title: optedOut
          ? 'Opt-out: não contatar (LGPD)'
          : 'Opt-out removido: pode voltar a contatar',
        detail: 'Alterado no painel',
      },
    });

    return { id: updated.id, optedOutAt: updated.optedOutAt };
  }

  async remove(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      include: {
        _count: { select: { sales: true, checkouts: true, outreachMessages: true } },
      },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');
    if (
      customer._count.sales > 0 ||
      customer._count.checkouts > 0 ||
      customer._count.outreachMessages > 0
    ) {
      throw new BadRequestException(
        'Cliente possui histórico (compras, checkouts ou disparos) e não pode ser removido. Use o opt-out para parar de contatá-lo.',
      );
    }

    await this.prisma.customer.delete({ where: { id: customerId } });
    return { ok: true };
  }

  async addInterest(input: CreateInterestInput) {
    let productName = input.productName;
    let productPrice = input.productPriceCents;

    if (input.productId) {
      const product = await this.prisma.product.findFirst({
        where: {
          id: input.productId,
          tenantId: input.tenantId,
          storeId: input.storeId,
        },
      });
      if (!product) throw new BadRequestException('Produto não encontrado.');
      productName = product.name;
      productPrice = product.priceCents;
    }

    if (!productName) {
      throw new BadRequestException('Informe o produto de interesse.');
    }

    const customer = await this.prisma.customer.findFirst({
      where: {
        id: input.customerId,
        tenantId: input.tenantId,
        storeId: input.storeId,
      },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');

    const interest = await this.prisma.customerInterest.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        customerId: input.customerId,
        productId: input.productId,
        productNameSnapshot: productName,
        productPriceCents: productPrice,
        source: input.source,
        notes: input.notes,
        status: 'open',
      },
    });

    await this.prisma.customerEvent.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        customerId: input.customerId,
        type: 'interest',
        title: `Interesse: ${productName}`,
        detail: input.notes ?? `Origem: ${input.source}`,
        metadata: JSON.stringify({ interestId: interest.id }),
      },
    });

    return interest;
  }
}
