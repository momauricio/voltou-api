import { CustomersService } from './customers.service';

describe('CustomersService lastContactedAt', () => {
  const prisma = {
    customer: { findMany: jest.fn(), findFirst: jest.fn() },
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
    expect(
      (rows[0] as { customerEvents?: unknown }).customerEvents,
    ).toBeUndefined();
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
