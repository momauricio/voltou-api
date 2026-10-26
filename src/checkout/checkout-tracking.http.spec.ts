import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { RolesGuard } from '../auth/roles.guard';
import { signAccessToken } from '../auth/crypto.util';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

const ownerTenant = '11111111-1111-1111-1111-111111111111';
const otherTenant = '99999999-9999-9999-9999-999999999999';
const storeId = '22222222-2222-2222-2222-222222222222';
const checkoutId = '33333333-3333-3333-3333-333333333333';

function jwt(role: 'owner' | 'staff', tenantId = ownerTenant) {
  return signAccessToken({
    sub: `user-${role}`,
    tenantId,
    email: `${role}@voltou.test`,
    role,
  });
}

function paidCheckout(overrides: Record<string, unknown> = {}) {
  return {
    id: checkoutId,
    tenantId: ownerTenant,
    storeId,
    customerId: '44444444-4444-4444-4444-444444444444',
    productNameSnapshot: 'Tênis',
    amountCents: 15000,
    commissionCents: 750,
    couponCode: 'ANA10ABCD',
    status: 'paid',
    mpPaymentId: '1115',
    paidAt: new Date('2026-09-01T15:00:00.000Z'),
    paidLinesJson: null,
    trackingCode: null,
    fulfillmentMethod: 'delivery',
    fulfillmentStatus: 'awaiting',
    shippingCents: 0,
    shippingAddressJson: null,
    customer: { displayName: 'Ana Souza' },
    ...overrides,
  };
}

describe('owner checkout trackingCode (http)', () => {
  let app: INestApplication;
  const prisma = {
    checkout: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CheckoutController],
      providers: [
        CheckoutService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { sendPaymentReceived: jest.fn() } },
        { provide: WhatsAppService, useValue: { send: jest.fn() } },
        { provide: APP_GUARD, useClass: AccessTokenGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /checkouts/orders returns trackingCode for the owner tenant', async () => {
    prisma.checkout.findMany.mockResolvedValue([paidCheckout()]);
    prisma.$queryRawUnsafe.mockResolvedValue([
      { id: checkoutId, trackingCode: 'BR123456789BR' },
    ]);

    const res = await request(app.getHttpServer())
      .get('/checkouts/orders')
      .query({ tenantId: ownerTenant, storeId })
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .expect(200);

    expect(prisma.checkout.findMany).toHaveBeenCalledWith({
      where: { tenantId: ownerTenant, storeId, status: 'paid' },
      include: { customer: true },
      orderBy: { paidAt: 'desc' },
      take: 100,
    });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      'SELECT id, trackingCode FROM Checkout WHERE tenantId = ? AND storeId = ? AND status = ?',
      ownerTenant,
      storeId,
      'paid',
    );
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: checkoutId,
          trackingCode: 'BR123456789BR',
          fulfillmentMethod: 'delivery',
          fulfillmentStatus: 'awaiting',
          shippingCents: 0,
          shippingAddress: null,
          customerName: 'Ana Souza',
        }),
      ]),
    );
  });

  it('GET /checkouts/orders filters by ?fulfillmentStatus', async () => {
    prisma.checkout.findMany.mockResolvedValue([]);
    prisma.$queryRawUnsafe.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/checkouts/orders')
      .query({ tenantId: ownerTenant, storeId, fulfillmentStatus: 'ready' })
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .expect(200);

    expect(prisma.checkout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: ownerTenant,
          storeId,
          status: 'paid',
          fulfillmentStatus: 'ready',
        },
        take: 100,
      }),
    );
  });

  it('GET /checkouts/orders is 401 without a token', async () => {
    await request(app.getHttpServer())
      .get('/checkouts/orders')
      .query({ tenantId: ownerTenant, storeId })
      .expect(401);
    expect(prisma.checkout.findMany).not.toHaveBeenCalled();
  });

  it('GET /checkouts/orders forbids another tenantId on owner JWT', async () => {
    await request(app.getHttpServer())
      .get('/checkouts/orders')
      .query({ tenantId: otherTenant, storeId })
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .expect(403);
    expect(prisma.checkout.findMany).not.toHaveBeenCalled();
  });

  it('PATCH /checkouts/:id/fulfillment sets trackingCode when fulfillmentMethod is still null', async () => {
    prisma.checkout.findFirst.mockResolvedValue(
      paidCheckout({ fulfillmentMethod: null }),
    );

    const res = await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({
        tenantId: ownerTenant,
        storeId,
        trackingCode: 'ABC123',
      })
      .expect(200);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      'UPDATE Checkout SET trackingCode = ? WHERE id = ?',
      'ABC123',
      checkoutId,
    );
    expect(res.body.trackingCode).toBe('ABC123');
  });

  it('PATCH /checkouts/:id/fulfillment sets trackingCode on delivery', async () => {
    prisma.checkout.findFirst.mockResolvedValue(paidCheckout());

    const res = await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({
        tenantId: ownerTenant,
        storeId,
        status: 'shipped',
        trackingCode: '  BR123456789BR  ',
      })
      .expect(200);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      'UPDATE Checkout SET trackingCode = ? WHERE id = ?',
      'BR123456789BR',
      checkoutId,
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        id: checkoutId,
        trackingCode: 'BR123456789BR',
      }),
    );
  });

  it('PATCH /checkouts/:id/fulfillment clears trackingCode with null', async () => {
    prisma.checkout.findFirst.mockResolvedValue(
      paidCheckout({ trackingCode: 'OLD' }),
    );

    const res = await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({
        tenantId: ownerTenant,
        storeId,
        trackingCode: null,
      })
      .expect(200);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      'UPDATE Checkout SET trackingCode = ? WHERE id = ?',
      null,
      checkoutId,
    );
    expect(res.body.trackingCode).toBeNull();
  });

  it('PATCH rejects trackingCode on pickup / retirada', async () => {
    prisma.checkout.findFirst.mockResolvedValue(
      paidCheckout({ fulfillmentMethod: 'pickup' }),
    );

    const res = await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({
        tenantId: ownerTenant,
        storeId,
        trackingCode: 'BR123',
      })
      .expect(400);

    expect(res.body.message).toBe(
      'Tracking code is only allowed for delivery orders',
    );
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('PATCH rejects trackingCode on retirada', async () => {
    prisma.checkout.findFirst.mockResolvedValue(
      paidCheckout({ fulfillmentMethod: 'retirada' }),
    );

    await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({
        tenantId: ownerTenant,
        storeId,
        trackingCode: 'BR123',
      })
      .expect(400);

    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('PATCH does not update a checkout from another tenant', async () => {
    prisma.checkout.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({
        tenantId: ownerTenant,
        storeId,
        trackingCode: 'BR123',
      })
      .expect(404);

    expect(prisma.checkout.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: checkoutId,
          tenantId: ownerTenant,
          status: 'paid',
        }),
      }),
    );
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('PATCH forbids another tenantId on owner JWT', async () => {
    await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({
        tenantId: otherTenant,
        storeId,
        trackingCode: 'BR123',
      })
      .expect(403);
    expect(prisma.checkout.findFirst).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('PATCH does not set trackingCode on a pending checkout', async () => {
    prisma.checkout.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({
        tenantId: ownerTenant,
        storeId,
        trackingCode: 'BR123',
      })
      .expect(404);

    expect(prisma.checkout.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: checkoutId,
          tenantId: ownerTenant,
          status: 'paid',
        }),
      }),
    );
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('PATCH is 401 without a token', async () => {
    await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .send({
        tenantId: ownerTenant,
        storeId,
        trackingCode: 'BR123',
      })
      .expect(401);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('PATCH rejects trackingCode longer than 120', async () => {
    prisma.checkout.findFirst.mockResolvedValue(paidCheckout());

    await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({
        tenantId: ownerTenant,
        storeId,
        trackingCode: 'x'.repeat(121),
      })
      .expect(400)
      .expect((res) => {
        expect(res.body.message).toBe('Tracking code exceeds 120 characters');
      });

    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('PATCH rejects a non-string trackingCode', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({ tenantId: ownerTenant, storeId, trackingCode: 123 })
      .expect(400);

    expect(res.body.message).toBe('Invalid tracking code');
    expect(prisma.checkout.findFirst).not.toHaveBeenCalled();
  });

  it('PATCH falls back to the JWT tenant when body.tenantId is missing', async () => {
    prisma.checkout.findFirst.mockResolvedValue(paidCheckout());

    await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({ storeId, trackingCode: 'BR1' })
      .expect(200);

    expect(prisma.checkout.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: ownerTenant }),
      }),
    );
  });

  it('PATCH 404 uses the prod wording', async () => {
    prisma.checkout.findFirst.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({ tenantId: ownerTenant, storeId, trackingCode: 'BR1' })
      .expect(404);

    expect(res.body.message).toBe('Pedido nao encontrado.');
  });

  it('PATCH never returns customer phoneEnc/phoneHash (intentional fix vs prod)', async () => {
    prisma.checkout.findFirst.mockResolvedValue(paidCheckout());

    const res = await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({ tenantId: ownerTenant, storeId, trackingCode: 'BR1' })
      .expect(200);

    expect(prisma.checkout.findFirst).toHaveBeenCalledWith({
      where: { id: checkoutId, tenantId: ownerTenant, status: 'paid', storeId },
      include: { customer: { omit: { phoneEnc: true, phoneHash: true } } },
    });
    expect(res.body.customer).not.toHaveProperty('phoneEnc');
    expect(res.body.customer).not.toHaveProperty('phoneHash');
  });
});
