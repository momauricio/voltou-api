import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CUSTOMER_EVENT_CONTACTED } from '../customers/customer-events';
import { RegisterContactInput } from '../shared/schemas';

export type RegisterContactCommand = RegisterContactInput & {
  staffUserId: string;
};

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  listStores() {
    return this.prisma.store.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  async listCustomers() {
    const rows = await this.prisma.customer.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: { select: { id: true, name: true } },
        store: { select: { id: true, name: true, slug: true } },
        customerEvents: {
          where: { type: CUSTOMER_EVENT_CONTACTED },
          orderBy: { occurredAt: 'desc' },
          take: 1,
          select: { occurredAt: true },
        },
      },
    });

    return rows.map(({ customerEvents, phoneHash, phoneEnc, ...customer }) => ({
      ...customer,
      lastContactedAt: customerEvents[0]?.occurredAt ?? null,
    }));
  }

  async registerContact(customerId: string, input: RegisterContactCommand) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');

    const occurredAt = input.occurredAt
      ? new Date(input.occurredAt)
      : new Date();

    return this.prisma.customerEvent.create({
      data: {
        tenantId: customer.tenantId,
        storeId: customer.storeId,
        customerId: customer.id,
        type: CUSTOMER_EVENT_CONTACTED,
        title: 'Contatado pela equipe Voltou',
        detail:
          input.note ??
          (input.channel ? `Canal: ${input.channel}` : null),
        occurredAt,
        metadata: JSON.stringify({
          staffUserId: input.staffUserId,
          ...(input.channel ? { channel: input.channel } : {}),
        }),
      },
    });
  }
}
