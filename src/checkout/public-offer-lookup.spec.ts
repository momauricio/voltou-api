import { NotFoundException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

const branding = {
  checkoutLogoUrl: null as string | null,
  checkoutPrimaryColor: null as string | null,
  checkoutSecondaryColor: null as string | null,
  checkoutFontFamily: null as string | null,
  checkoutMessage: null as string | null,
};

function makeStore(id: string, name: string, slug: string) {
  return { id, name, slug, ...branding };
}

function makeCheckout(store: ReturnType<typeof makeStore>, couponCode: string) {
  return {
    id: `chk-${store.id}`,
    storeId: store.id,
    couponCode,
    status: 'pending',
    expiresAt: null,
    paidAt: null,
    amountCents: 1000,
    productNameSnapshot: 'Produto',
    paidLinesJson: null,
    listPriceCents: 1000,
    discountBps: 0,
    currency: 'BRL',
    customer: { displayName: 'Cliente' },
    store,
    product: null,
  };
}

function makePrisma(stores: ReturnType<typeof makeStore>[], checkouts: ReturnType<typeof makeCheckout>[]) {
  const storeBySlug = new Map(stores.map((s) => [s.slug, s]));
  const checkoutByStoreCoupon = new Map(
    checkouts.map((c) => [`${c.storeId}:${c.couponCode}`, c]),
  );
  return {
    store: {
      findUnique: jest.fn(async ({ where }: { where: { slug?: string } }) => {
        if (!where.slug) return null;
        return storeBySlug.get(where.slug) ?? null;
      }),
      // Simulates the bug: findFirst on a duplicated slug always returns the first store.
      findFirst: jest.fn(async () => stores[0] ?? null),
    },
    checkout: {
      findUnique: jest.fn(
        async ({
          where,
          include,
        }: {
          where: { storeId_couponCode?: { storeId: string; couponCode: string } };
          include?: unknown;
        }) => {
          const key = where.storeId_couponCode;
          if (!key) return null;
          const row = checkoutByStoreCoupon.get(`${key.storeId}:${key.couponCode}`) ?? null;
          return row && include ? row : row;
        },
      ),
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { storeId?: string; couponCode?: string };
        }) => {
          if (!where.storeId || !where.couponCode) return null;
          return (
            checkoutByStoreCoupon.get(`${where.storeId}:${where.couponCode}`) ??
            null
          );
        },
      ),
    },
  };
}

describe('public offer lookup by unique store slug', () => {
  const email = { sendVerifyEmail: jest.fn() };

  it('resolves the offer for the store matching the unique slug, not findFirst', async () => {
    const storeA = makeStore('s-a', 'Loja A', 'loja-a');
    const storeB = makeStore('s-b', 'Loja B', 'loja-b');
    const prisma = makePrisma(
      [storeA, storeB],
      [makeCheckout(storeA, 'ABC10'), makeCheckout(storeB, 'ABC10')],
    );
    const service = new CheckoutService(prisma as never, email as never);

    const a = await service.getPublicOfferStatus('loja-a', 'ABC10');
    const b = await service.getPublicOfferStatus('loja-b', 'ABC10');

    expect(a.storeSlug).toBe('loja-a');
    expect(a.storeName).toBe('Loja A');
    expect(b.storeSlug).toBe('loja-b');
    expect(b.storeName).toBe('Loja B');
    expect(prisma.store.findUnique).toHaveBeenCalled();
    expect(prisma.store.findFirst).not.toHaveBeenCalled();
  });

  it('still resolves the existing Loja Teste slug principal', async () => {
    const principal = makeStore('s-live', 'Loja Teste', 'principal');
    const other = makeStore('s-other', 'Outra Loja', 'outra-loja');
    const prisma = makePrisma(
      [other, principal],
      [
        makeCheckout(other, 'TESTE10'),
        makeCheckout(principal, 'TESTE10'),
      ],
    );
    const service = new CheckoutService(prisma as never, email as never);

    const result = await service.getPublicOfferStatus('principal', 'TESTE10');

    expect(result.storeSlug).toBe('principal');
    expect(result.storeName).toBe('Loja Teste');
    expect(result.couponCode).toBe('TESTE10');
    expect(prisma.store.findUnique).toHaveBeenCalledWith({
      where: { slug: 'principal' },
    });
    expect(prisma.store.findFirst).not.toHaveBeenCalled();
  });

  it('404s when the unique slug does not exist instead of returning another store', async () => {
    const storeA = makeStore('s-a', 'Loja A', 'loja-a');
    const prisma = makePrisma([storeA], [makeCheckout(storeA, 'ABC10')]);
    const service = new CheckoutService(prisma as never, email as never);

    await expect(
      service.getPublicOfferStatus('loja-inexistente', 'ABC10'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Store.slug uniqueness in prisma schema', () => {
  it('declares Store.slug as globally unique', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const schema = fs.readFileSync(
      path.join(__dirname, '../../prisma/schema.prisma'),
      'utf8',
    );
    const storeBlock = schema.match(/model Store \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(storeBlock).toMatch(/slug\s+String\s+@unique/);
  });
});
