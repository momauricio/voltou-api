import { NotFoundException } from '@nestjs/common';
import { StaffService } from './staff.service';
import { CUSTOMER_EVENT_CONTACTED } from '../customers/customer-events';
import {
  encryptPhone,
  hashPhone,
  normalizePhoneBr,
} from '../common/phone.util';

describe('StaffService', () => {
  const prisma = {
    store: { findMany: jest.fn(), findUnique: jest.fn() },
    customer: { findMany: jest.fn(), findUnique: jest.fn() },
    customerEvent: { create: jest.fn() },
  };
  const service = new StaffService(prisma as never);

  function findManyWhere(): { storeId?: string; OR?: unknown[] } {
    const calls = prisma.customer.findMany.mock.calls as unknown as Array<
      [{ where?: { storeId?: string; OR?: unknown[] } }]
    >;
    return calls[0]?.[0]?.where ?? {};
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists every store with tenant name and customerCount', async () => {
    prisma.store.findMany.mockResolvedValue([
      {
        id: 's1',
        name: 'Loja A',
        slug: 'principal',
        timezone: 'America/Sao_Paulo',
        tenantId: 't1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        tenant: { id: 't1', name: 'Tenant A', slug: 'tenant-a' },
        _count: { customers: 3 },
      },
      {
        id: 's2',
        name: 'Loja B',
        slug: 'principal',
        timezone: 'America/Sao_Paulo',
        tenantId: 't2',
        createdAt: new Date('2026-02-01T00:00:00Z'),
        tenant: { id: 't2', name: 'Tenant B', slug: 'tenant-b' },
        _count: { customers: 0 },
      },
    ]);

    const stores = await service.listStores();

    expect(prisma.store.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          _count: { select: { customers: true } },
        },
      }),
    );
    expect(stores).toHaveLength(2);
    expect(stores.map((s) => s.tenant.name)).toEqual(['Tenant A', 'Tenant B']);
    expect(stores.map((s) => s.customerCount)).toEqual([3, 0]);
    expect(stores[0]).not.toHaveProperty('_count');
  });

  it('lists customers of one store with lastContactedAt and does not query other stores', async () => {
    const contactedAt = new Date('2026-08-20T15:00:00Z');
    const allCustomers = [
      {
        id: 'c1',
        tenantId: 't1',
        storeId: 's1',
        displayName: 'Ana',
        phoneMasked: '(11) *****-0001',
        phoneEnc: encryptPhone('+5511999990001'),
        phoneHash: 'hash-ana',
        optedOutAt: null,
        createdAt: new Date(),
        customerEvents: [{ occurredAt: contactedAt }],
        tenant: { id: 't1', name: 'Tenant A' },
        store: { id: 's1', name: 'Loja A', slug: 'principal' },
      },
      {
        id: 'c2',
        tenantId: 't2',
        storeId: 's2',
        displayName: 'Bruno',
        phoneMasked: '+55 ****-0002',
        phoneEnc: encryptPhone('+5511999990002'),
        phoneHash: 'hash-bruno',
        optedOutAt: null,
        createdAt: new Date(),
        customerEvents: [],
        tenant: { id: 't2', name: 'Tenant B' },
        store: { id: 's2', name: 'Loja B', slug: 'principal' },
      },
    ];
    prisma.store.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === 's1' || where.id === 's2' ? { id: where.id } : null,
        ),
    );
    prisma.customer.findMany.mockImplementation(
      ({ where }: { where: { storeId?: string } }) =>
        Promise.resolve(
          allCustomers.filter((c) => c.storeId === where.storeId),
        ),
    );

    const customers = await service.listCustomersForStore('s1');

    expect(prisma.store.findUnique).toHaveBeenCalledWith({
      where: { id: 's1' },
      select: { id: true },
    });
    const listedWhere = findManyWhere();
    expect(listedWhere.storeId).toBe('s1');
    expect(customers).toHaveLength(1);
    expect(customers.map((c) => c.id)).toEqual(['c1']);
    expect(customers[0].lastContactedAt).toEqual(contactedAt);
    expect(customers[0].tenant.name).toBe('Tenant A');
    expect(customers[0].store.name).toBe('Loja A');
    expect(customers[0].phoneE164).toBe('+5511999990001');
    expect(customers[0]).not.toHaveProperty('phoneEnc');
    expect(customers[0]).not.toHaveProperty('phoneHash');

    const otherStore = await service.listCustomersForStore('s2');
    expect(otherStore).toHaveLength(1);
    expect(otherStore[0].id).toBe('c2');
    expect(otherStore[0].phoneE164).toBe('+5511999990002');
  });

  it('returns 404 when listing customers of a missing store', async () => {
    prisma.store.findUnique.mockResolvedValue(null);

    await expect(
      service.listCustomersForStore('missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });

  it('searches name and phone only inside the store slice', async () => {
    prisma.store.findUnique.mockResolvedValue({ id: 's1' });
    prisma.customer.findMany.mockResolvedValue([]);

    await service.listCustomersForStore('s1', 'Ana');

    const nameWhere = findManyWhere();
    expect(nameWhere.storeId).toBe('s1');
    expect(nameWhere.OR).toEqual(
      expect.arrayContaining([{ displayName: { contains: 'Ana' } }]),
    );
  });

  it('matches phone search by hash inside the same store only', async () => {
    prisma.store.findUnique.mockResolvedValue({ id: 's1' });
    prisma.customer.findMany.mockResolvedValue([]);

    await service.listCustomersForStore('s1', '11999990001');

    const expectedHash = hashPhone(normalizePhoneBr('11999990001'));
    const phoneWhere = findManyWhere();
    expect(phoneWhere.storeId).toBe('s1');
    expect(phoneWhere.OR).toEqual(
      expect.arrayContaining([
        { displayName: { contains: '11999990001' } },
        { phoneHash: expectedHash },
      ]),
    );
  });

  it('persists a contacted event with occurredAt for merchant cards', async () => {
    const occurredAt = new Date('2026-08-31T10:30:00.000Z');
    prisma.customer.findUnique.mockResolvedValue({
      id: 'c1',
      tenantId: 't1',
      storeId: 's1',
      displayName: 'Ana',
    });
    prisma.customerEvent.create.mockResolvedValue({
      id: 'evt-1',
      type: CUSTOMER_EVENT_CONTACTED,
      occurredAt,
      customerId: 'c1',
      tenantId: 't1',
      storeId: 's1',
      title: 'Contatado pela equipe Voltou',
    });

    const event = await service.registerContact('c1', {
      staffUserId: 'staff-1',
      occurredAt: occurredAt.toISOString(),
      channel: 'call',
      note: 'Ligou e deixou recado',
    });

    const createCalls = prisma.customerEvent.create.mock
      .calls as unknown as Array<[{ data: { metadata: string } }]>;
    expect(createCalls[0]?.[0].data).toMatchObject({
      tenantId: 't1',
      storeId: 's1',
      customerId: 'c1',
      type: CUSTOMER_EVENT_CONTACTED,
      occurredAt,
      title: 'Contatado pela equipe Voltou',
    });
    const metadata = JSON.parse(createCalls[0][0].data.metadata) as {
      staffUserId?: string;
      channel?: string;
    };
    expect(metadata).toMatchObject({
      staffUserId: 'staff-1',
      channel: 'call',
    });
    expect(event.type).toBe(CUSTOMER_EVENT_CONTACTED);
    expect(event.occurredAt).toEqual(occurredAt);
  });

  it('rejects contact on unknown customer', async () => {
    prisma.customer.findUnique.mockResolvedValue(null);
    await expect(
      service.registerContact('missing', { staffUserId: 'staff-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customerEvent.create).not.toHaveBeenCalled();
  });
});
