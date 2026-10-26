import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { RolesGuard } from '../auth/roles.guard';
import { signAccessToken } from '../auth/crypto.util';
import { PrismaService } from '../prisma/prisma.service';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

const ownerTenant = '11111111-1111-1111-1111-111111111111';
const storeId = '22222222-2222-2222-2222-222222222222';

function ownerJwt() {
  return signAccessToken({
    sub: 'user-owner',
    tenantId: ownerTenant,
    email: 'owner@voltou.test',
    role: 'owner',
  });
}

describe('PATCH /stores/fulfillment (prod rules)', () => {
  let app: INestApplication;
  const storeRow = {
    id: storeId,
    tenantId: ownerTenant,
    name: 'Loja',
    deliveryEnabled: true,
    shippingCents: 0,
    pickupAddressText: 'Rua Exemplo, 100',
    orderNotifyPhoneE164: '+5511987654321',
  };
  const prisma = {
    store: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StoresController],
      providers: [
        StoresService,
        { provide: PrismaService, useValue: prisma },
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
    prisma.store.findFirst.mockResolvedValue(storeRow);
    prisma.store.update.mockResolvedValue(storeRow);
  });

  it('returns 400 when pickup address is empty', async () => {
    const res = await request(app.getHttpServer())
      .patch('/stores/fulfillment')
      .set('Authorization', `Bearer ${ownerJwt()}`)
      .send({
        tenantId: ownerTenant,
        storeId,
        pickupAddressText: '   ',
        orderNotifyPhoneE164: '11987654321',
      })
      .expect(400);

    expect(res.body.message).toBe(
      'Endereco de retirada e telefone de aviso sao obrigatorios',
    );
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('returns 400 when the order-alert WhatsApp is empty', async () => {
    const res = await request(app.getHttpServer())
      .patch('/stores/fulfillment')
      .set('Authorization', `Bearer ${ownerJwt()}`)
      .send({
        tenantId: ownerTenant,
        storeId,
        pickupAddressText: 'Rua Exemplo, 100 — Centro',
        orderNotifyPhoneE164: '',
      })
      .expect(400);

    expect(res.body.message).toBe(
      'Endereco de retirada e telefone de aviso sao obrigatorios',
    );
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('saves when pickup address and notify phone are filled', async () => {
    prisma.store.update.mockResolvedValue({
      ...storeRow,
      pickupAddressText: 'Rua Exemplo, 100 — Centro',
      orderNotifyPhoneE164: '+5511987654321',
    });

    const res = await request(app.getHttpServer())
      .patch('/stores/fulfillment')
      .set('Authorization', `Bearer ${ownerJwt()}`)
      .send({
        tenantId: ownerTenant,
        storeId,
        pickupAddressText: '  Rua Exemplo, 100 — Centro  ',
        orderNotifyPhoneE164: '11987654321',
      })
      .expect(200);

    expect(prisma.store.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: storeId },
        data: expect.objectContaining({
          pickupAddressText: 'Rua Exemplo, 100 — Centro',
          orderNotifyPhoneE164: '+5511987654321',
        }),
      }),
    );
    expect(res.body).toMatchObject({
      storeId,
      pickupAddressText: 'Rua Exemplo, 100 — Centro',
      orderNotifyPhoneE164: '+5511987654321',
    });
  });

  function patch(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch('/stores/fulfillment')
      .set('Authorization', `Bearer ${ownerJwt()}`)
      .send({ tenantId: ownerTenant, storeId, ...body });
  }

  it('requires both fields in the body even if the store already has them saved', async () => {
    const res = await patch({ deliveryEnabled: false }).expect(400);
    expect(res.body.message).toBe(
      'Endereco de retirada e telefone de aviso sao obrigatorios',
    );
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('accepts a landline (normalizePhoneBr, 12 digits)', async () => {
    await patch({
      pickupAddressText: 'Rua A, 1',
      orderNotifyPhoneE164: '(11) 3333-4444',
    }).expect(200);
    expect(prisma.store.update).toHaveBeenCalledWith({
      where: { id: storeId },
      data: { pickupAddressText: 'Rua A, 1', orderNotifyPhoneE164: '+551133334444' },
    });
  });

  it('rejects a phone that does not normalize to 12–13 digits', async () => {
    const res = await patch({
      pickupAddressText: 'Rua A, 1',
      orderNotifyPhoneE164: '12345',
    }).expect(400);
    expect(res.body.message).toBe('WhatsApp de aviso inválido.');
  });

  it('caps pickupAddressText at 500 and the phone at 20 characters', async () => {
    await patch({
      pickupAddressText: 'x'.repeat(501),
      orderNotifyPhoneE164: '11987654321',
    }).expect(400);
    await patch({
      pickupAddressText: 'Rua A, 1',
      orderNotifyPhoneE164: '1'.repeat(21),
    }).expect(400);
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('returns zod errors as a joined string', async () => {
    const res = await patch({
      pickupAddressText: 'Rua A, 1',
      orderNotifyPhoneE164: '11987654321',
      shippingCents: -1,
    }).expect(400);
    expect(typeof res.body.message).toBe('string');
  });

  it('updates delivery and shipping alongside the required fields', async () => {
    await patch({
      pickupAddressText: 'Rua A, 1',
      orderNotifyPhoneE164: '+55 11 98765-4321',
      deliveryEnabled: false,
      shippingCents: 1500,
    }).expect(200);
    expect(prisma.store.update).toHaveBeenCalledWith({
      where: { id: storeId },
      data: {
        deliveryEnabled: false,
        shippingCents: 1500,
        pickupAddressText: 'Rua A, 1',
        orderNotifyPhoneE164: '+5511987654321',
      },
    });
  });
});
