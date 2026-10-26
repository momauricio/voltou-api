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
  const checkoutByStoreCoupon = new Map(
    checkouts.map((c) => [`${c.storeId}:${c.couponCode}`, c]),
  );
  return {
    store: {
      findFirst: jest.fn(async ({ where }: { where: { slug?: string } }) => {
        if (!where.slug) return null;
        return stores.find((s) => s.slug === where.slug) ?? null;
      }),
    },
    checkout: {
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

function makeService(prisma: ReturnType<typeof makePrisma>) {
  const email = { sendVerifyEmail: jest.fn() };
  const whatsapp = { send: jest.fn() };
  return new CheckoutService(prisma as never, email as never, whatsapp as never);
}

describe('public offer lookup by store slug (prod: findFirst, lowercase then exact)', () => {
  it('resolves the offer for the store matching the slug', async () => {
    const storeA = makeStore('s-a', 'Loja A', 'loja-a');
    const storeB = makeStore('s-b', 'Loja B', 'loja-b');
    const prisma = makePrisma(
      [storeA, storeB],
      [makeCheckout(storeA, 'ABC10'), makeCheckout(storeB, 'ABC10')],
    );
    const service = makeService(prisma);

    const a = await service.getPublicOfferStatus('loja-a', 'abc10');
    const b = await service.getPublicOfferStatus(' Loja-B ', 'ABC10');

    expect(a.storeSlug).toBe('loja-a');
    expect(a.storeName).toBe('Loja A');
    expect(b.storeSlug).toBe('loja-b');
    expect(b.storeName).toBe('Loja B');
    expect(prisma.store.findFirst).toHaveBeenCalledWith({
      where: { slug: 'loja-b' },
    });
    expect(prisma.checkout.findFirst).toHaveBeenCalledWith({
      where: { storeId: 's-b', couponCode: 'ABC10' },
      include: { customer: true, store: true, product: true },
    });
  });

  it('falls back to the exact-case slug when the lowercase one is not found', async () => {
    const mixed = makeStore('s-m', 'Loja Mista', 'LojaMista');
    const prisma = makePrisma([mixed], [makeCheckout(mixed, 'TESTE10')]);
    const service = makeService(prisma);

    const result = await service.getPublicOfferStatus('LojaMista', 'TESTE10');

    expect(result.storeSlug).toBe('LojaMista');
    expect(prisma.store.findFirst).toHaveBeenNthCalledWith(1, {
      where: { slug: 'lojamista' },
    });
    expect(prisma.store.findFirst).toHaveBeenNthCalledWith(2, {
      where: { slug: 'LojaMista' },
    });
  });

  it('404s when the slug does not exist', async () => {
    const storeA = makeStore('s-a', 'Loja A', 'loja-a');
    const prisma = makePrisma([storeA], [makeCheckout(storeA, 'ABC10')]);
    const service = makeService(prisma);

    await expect(
      service.getPublicOfferStatus('loja-inexistente', 'ABC10'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when the coupon does not exist on the store', async () => {
    const storeA = makeStore('s-a', 'Loja A', 'loja-a');
    const prisma = makePrisma([storeA], [makeCheckout(storeA, 'ABC10')]);
    const service = makeService(prisma);

    await expect(
      service.getPublicOfferStatus('loja-a', 'OUTRO'),
    ).rejects.toThrow('Oferta não encontrada.');
  });
});

describe('Store.slug uniqueness in prisma schema', () => {
  it('matches prod: slug unique per tenant only (no global @unique)', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const schema = fs.readFileSync(
      path.join(__dirname, '../../prisma/schema.prisma'),
      'utf8',
    );
    const storeBlock = schema.match(/model Store \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(storeBlock).toMatch(/\n\s*slug\s+String\s*\n/);
    expect(storeBlock).not.toMatch(/slug\s+String\s+@unique/);
    expect(storeBlock).toMatch(/@@unique\(\[tenantId, slug\]\)/);
  });

  it('pins the earliest principal row so later duplicate rewrites cannot steal it', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const sql = fs.readFileSync(
      path.join(
        __dirname,
        '../../prisma/migrations/20260902140000_store_slug_unique/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(/_store_slug_keep/);
    expect(sql).toMatch(/WHERE "slug" = 'principal'/);
    expect(sql).toMatch(
      /ORDER BY datetime\("createdAt"\) ASC, "id" ASC/,
    );
    expect(sql).toMatch(
      /WHERE "id" NOT IN \(SELECT "id" FROM "_store_slug_keep"\)/,
    );
  });
});
