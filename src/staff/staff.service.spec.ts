import { NotFoundException } from '@nestjs/common';
import { StaffService } from './staff.service';
import { CUSTOMER_EVENT_CONTACTED } from '../customers/customer-events';

describe('StaffService', () => {
  const prisma = {
    store: { findMany: jest.fn() },
    customer: { findMany: jest.fn(), findUnique: jest.fn() },
    customerEvent: { create: jest.fn() },
  };
  const service = new StaffService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists every store with tenant name', async () => {
    prisma.store.findMany.mockResolvedValue([
      {
        id: 's1',
        name: 'Loja A',
        slug: 'principal',
        timezone: 'America/Sao_Paulo',
        tenantId: 't1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        tenant: { id: 't1', name: 'Tenant A', slug: 'tenant-a' },
      },
      {
        id: 's2',
        name: 'Loja B',
        slug: 'principal',
        timezone: 'America/Sao_Paulo',
        tenantId: 't2',
        createdAt: new Date('2026-02-01T00:00:00Z'),
        tenant: { id: 't2', name: 'Tenant B', slug: 'tenant-b' },
      },
    ]);

    const stores = await service.listStores();

    expect(prisma.store.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { tenant: { select: { id: true, name: true, slug: true } } },
      }),
    );
    expect(stores).toHaveLength(2);
    expect(stores.map((s) => s.tenant.name)).toEqual(['Tenant A', 'Tenant B']);
  });

  it('lists customers across tenants with lastContactedAt', async () => {
    const contactedAt = new Date('2026-08-20T15:00:00Z');
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'c1',
        tenantId: 't1',
        storeId: 's1',
        displayName: 'Ana',
        phoneMasked: '+55 ****-0001',
        optedOutAt: null,
        createdAt: new Date(),
        customerEvents: [{ occurredAt: contactedAt }],
        tenant: { id: 't1', name: 'Tenant A' },
        store: { id: 's1', name: 'Loja A' },
      },
      {
        id: 'c2',
        tenantId: 't2',
        storeId: 's2',
        displayName: 'Bruno',
        phoneMasked: '+55 ****-0002',
        optedOutAt: null,
        createdAt: new Date(),
        customerEvents: [],
        tenant: { id: 't2', name: 'Tenant B' },
        store: { id: 's2', name: 'Loja B' },
      },
    ]);

    const customers = await service.listCustomers();

    expect(prisma.customer.findMany.mock.calls[0][0].where).toBeUndefined();
    expect(customers[0].lastContactedAt).toEqual(contactedAt);
    expect(customers[1].lastContactedAt).toBeNull();
    expect(customers[0].tenant.name).toBe('Tenant A');
    expect(customers[1].store.name).toBe('Loja B');
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

    expect(prisma.customerEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't1',
        storeId: 's1',
        customerId: 'c1',
        type: CUSTOMER_EVENT_CONTACTED,
        occurredAt,
        title: 'Contatado pela equipe Voltou',
      }),
    });
    const metadata = JSON.parse(
      (prisma.customerEvent.create.mock.calls[0][0].data as { metadata: string })
        .metadata,
    );
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
