import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { RolesGuard } from '../auth/roles.guard';
import { signAccessToken } from '../auth/crypto.util';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
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
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CheckoutController],
      providers: [
        CheckoutService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { sendPaymentReceived: jest.fn() } },
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
    prisma.checkout.findMany.mockResolvedValue([
      paidCheckout({ trackingCode: 'BR123456789BR' }),
    ]);

    const res = await request(app.getHttpServer())
      .get('/checkouts/orders')
      .query({ tenantId: ownerTenant, storeId })
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .expect(200);

    expect(prisma.checkout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: ownerTenant,
          storeId,
          status: 'paid',
        }),
      }),
    );
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: checkoutId,
          trackingCode: 'BR123456789BR',
          fulfillmentMethod: 'delivery',
          customerName: 'Ana Souza',
        }),
      ]),
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

  it('PATCH /checkouts/:id/fulfillment sets trackingCode on delivery', async () => {
    prisma.checkout.findFirst.mockResolvedValue(paidCheckout());
    prisma.checkout.update.mockResolvedValue(
      paidCheckout({ trackingCode: 'BR123456789BR' }),
    );

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

    expect(prisma.checkout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: checkoutId },
        data: expect.objectContaining({ trackingCode: 'BR123456789BR' }),
      }),
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
    prisma.checkout.update.mockResolvedValue(paidCheckout({ trackingCode: null }));

    const res = await request(app.getHttpServer())
      .patch(`/checkouts/${checkoutId}/fulfillment`)
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({
        tenantId: ownerTenant,
        storeId,
        trackingCode: null,
      })
      .expect(200);

    expect(prisma.checkout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ trackingCode: null }),
      }),
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

    expect(JSON.stringify(res.body)).toMatch(/entrega|rastreio/i);
    expect(prisma.checkout.update).not.toHaveBeenCalled();
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

    expect(prisma.checkout.update).not.toHaveBeenCalled();
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
        }),
      }),
    );
    expect(prisma.checkout.update).not.toHaveBeenCalled();
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
    expect(prisma.checkout.update).not.toHaveBeenCalled();
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
      .expect(400);

    expect(prisma.checkout.update).not.toHaveBeenCalled();
  });
});
