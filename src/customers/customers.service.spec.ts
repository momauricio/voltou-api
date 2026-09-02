import { CustomersService } from './customers.service';

describe('CustomersService lastContactedAt', () => {
  const prisma = {
    customer: { findMany: jest.fn(), findFirst: jest.fn() },
    customerEvent: { findFirst: jest.fn() },
  };
  const service = new CustomersService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes lastContactedAt from the latest contacted event', async () => {
    const occurredAt = new Date('2026-08-15T18:00:00Z');
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'c1',
        displayName: 'Ana',
        phoneMasked: '(11) *****-0001',
        phoneEnc: 'enc-should-not-leak',
        phoneHash: 'hash-should-not-leak',
        customerEvents: [{ occurredAt }],
        customerInterests: [],
        sales: [],
        checkouts: [],
        outreachMessages: [],
        _count: { sales: 0, customerInterests: 0, checkouts: 0 },
      },
    ]);

    const rows = await service.list('tenant-1', 'store-1');

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          customerEvents: expect.objectContaining({
            where: { type: 'contacted' },
          }),
        }),
      }),
    );
    expect(rows[0].lastContactedAt).toEqual(occurredAt);
    expect(rows[0].phoneMasked).toBe('(11) *****-0001');
    expect(rows[0]).not.toHaveProperty('phoneEnc');
    expect(rows[0]).not.toHaveProperty('phoneHash');
    expect(
      (rows[0] as { customerEvents?: unknown }).customerEvents,
    ).toBeUndefined();
  });

  it('reads lastContactedAt on detail even when newer events fill the timeline', async () => {
    const contactedAt = new Date('2026-07-01T12:00:00Z');
    prisma.customer.findFirst.mockResolvedValue({
      id: 'c1',
      displayName: 'Ana',
      phoneMasked: '(11) *****-0001',
      phoneEnc: 'enc-should-not-leak',
      phoneHash: 'hash-should-not-leak',
      customerEvents: Array.from({ length: 50 }, (_, i) => ({
        type: 'note',
        occurredAt: new Date(`2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`),
      })),
    });
    prisma.customerEvent.findFirst.mockResolvedValue({ occurredAt: contactedAt });

    const detail = await service.getDetail('tenant-1', 'c1');

    expect(prisma.customerEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          customerId: 'c1',
          type: 'contacted',
        },
      }),
    );
    expect(detail.lastContactedAt).toEqual(contactedAt);
    expect(detail.phoneMasked).toBe('(11) *****-0001');
    expect(detail).not.toHaveProperty('phoneEnc');
    expect(detail).not.toHaveProperty('phoneHash');
  });

  it('returns null lastContactedAt when staff has not contacted the customer', async () => {
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'c2',
        displayName: 'Bruno',
        customerEvents: [],
        customerInterests: [],
        sales: [],
        checkouts: [],
        outreachMessages: [],
        _count: { sales: 0, customerInterests: 0, checkouts: 0 },
      },
    ]);

    const rows = await service.list('tenant-1');
    expect(rows[0].lastContactedAt).toBeNull();
  });
});
