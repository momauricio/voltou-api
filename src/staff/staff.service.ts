import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CUSTOMER_EVENT_CONTACTED } from '../customers/customer-events';
import { RegisterContactInput } from '../shared/schemas';
import {
  decryptPhone,
  hashPhone,
  normalizePhoneBr,
} from '../common/phone.util';

function decryptPhoneSafe(phoneEnc?: string | null): string | null {
  if (!phoneEnc) return null;
  try {
    return decryptPhone(phoneEnc);
  } catch {
    return null;
  }
}

function phoneHashForSearch(q: string): string | undefined {
  const digits = q.replace(/\D/g, '');
  if (digits.length < 8) return undefined;
  return hashPhone(normalizePhoneBr(q));
}

const customerListInclude = {
  tenant: { select: { id: true, name: true } },
  store: { select: { id: true, name: true, slug: true } },
  customerEvents: {
    where: { type: CUSTOMER_EVENT_CONTACTED },
    orderBy: { occurredAt: 'desc' as const },
    take: 1,
    select: { occurredAt: true },
  },
};

export type RegisterContactCommand = RegisterContactInput & {
  staffUserId: string;
};

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async listStores() {
    const rows = await this.prisma.store.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        _count: { select: { customers: true } },
      },
    });

    return rows.map(({ _count, ...store }) => ({
      ...store,
      customerCount: _count.customers,
    }));
  }

  async listCustomersForStore(storeId: string, search?: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true },
    });
    if (!store) throw new NotFoundException('Loja não encontrada.');

    const q = search?.trim() || undefined;
    const searchPhoneHash = q ? phoneHashForSearch(q) : undefined;

    const rows = await this.prisma.customer.findMany({
      where: {
        storeId,
        ...(q
          ? {
              OR: [
                { displayName: { contains: q } },
                ...(searchPhoneHash ? [{ phoneHash: searchPhoneHash }] : []),
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      omit: { phoneHash: true },
      include: customerListInclude,
    });

    return rows.map((row) => {
      const { customerEvents, phoneEnc, ...customer } = row;
      const result = {
        ...customer,
        phoneE164: decryptPhoneSafe(phoneEnc),
        lastContactedAt: customerEvents[0]?.occurredAt ?? null,
      };
      delete (result as { phoneHash?: string }).phoneHash;
      return result;
    });
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
          input.note ?? (input.channel ? `Canal: ${input.channel}` : null),
        occurredAt,
        metadata: JSON.stringify({
          staffUserId: input.staffUserId,
          ...(input.channel ? { channel: input.channel } : {}),
        }),
      },
    });
  }
}
