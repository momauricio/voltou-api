import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { RolesGuard } from '../auth/roles.guard';
import { signAccessToken } from '../auth/crypto.util';
import { CampaignsController } from '../campaigns/campaigns.controller';
import { CampaignsService } from '../campaigns/campaigns.service';
import { CheckoutController } from '../checkout/checkout.controller';
import { CheckoutService } from '../checkout/checkout.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

function jwt(role: 'owner' | 'staff', tenantId = '11111111-1111-1111-1111-111111111111') {
  return signAccessToken({
    sub: `user-${role}`,
    tenantId,
    email: `${role}@voltou.test`,
    role,
  });
}

describe('staff gates (http)', () => {
  let app: INestApplication;
  const campaigns = {
    health: () => ({ module: 'campaigns', status: 'ok' }),
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'camp-1' }),
    listMessages: jest.fn().mockResolvedValue([]),
    approveMessage: jest.fn(),
    rejectMessage: jest.fn(),
    approveAll: jest.fn(),
  };
  const checkouts = {
    health: () => ({ module: 'checkout', status: 'ok' }),
    create: jest.fn().mockResolvedValue({ id: 'chk-1' }),
    getByPublicToken: jest.fn(),
    markPaid: jest.fn(),
  };
  const staff = {
    listStores: jest.fn().mockResolvedValue([{ id: 's1' }]),
    listCustomers: jest.fn().mockResolvedValue([{ id: 'c1', lastContactedAt: null }]),
    registerContact: jest.fn().mockResolvedValue({
      id: 'evt-1',
      type: 'contacted',
      occurredAt: new Date('2026-08-31T10:00:00Z'),
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CampaignsController, CheckoutController, StaffController],
      providers: [
        { provide: CampaignsService, useValue: campaigns },
        { provide: CheckoutService, useValue: checkouts },
        { provide: StaffService, useValue: staff },
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

  it('lets owner list campaigns but forbids create/approve', async () => {
    const token = jwt('owner');
    await request(app.getHttpServer())
      .get('/campaigns')
      .query({
        tenantId: '11111111-1111-1111-1111-111111111111',
        storeId: '22222222-2222-2222-2222-222222222222',
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tenantId: '11111111-1111-1111-1111-111111111111',
        storeId: '22222222-2222-2222-2222-222222222222',
        name: 'Reativação',
        segment: 'todos',
        messageTemplate: 'Oi {{nome}}, sentimos sua falta',
      })
      .expect(403);

    await request(app.getHttpServer())
      .post('/campaigns/messages/m1/approve')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantId: '11111111-1111-1111-1111-111111111111' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/campaigns/messages/m1/reject')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantId: '11111111-1111-1111-1111-111111111111' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/campaigns/approve-all')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tenantId: '11111111-1111-1111-1111-111111111111',
        storeId: '22222222-2222-2222-2222-222222222222',
      })
      .expect(403);

    expect(campaigns.create).not.toHaveBeenCalled();
    expect(campaigns.approveMessage).not.toHaveBeenCalled();
    expect(campaigns.rejectMessage).not.toHaveBeenCalled();
    expect(campaigns.approveAll).not.toHaveBeenCalled();
  });

  it('lets owner create a checkout for its own tenant', async () => {
    const ownerTenant = '11111111-1111-1111-1111-111111111111';
    await request(app.getHttpServer())
      .post('/checkouts')
      .set('Authorization', `Bearer ${jwt('owner', ownerTenant)}`)
      .send({
        tenantId: ownerTenant,
        storeId: '22222222-2222-2222-2222-222222222222',
        customerId: '33333333-3333-3333-3333-333333333333',
        productId: '44444444-4444-4444-4444-444444444444',
      })
      .expect(201);

    expect(checkouts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: ownerTenant,
        storeId: '22222222-2222-2222-2222-222222222222',
        customerId: '33333333-3333-3333-3333-333333333333',
        productId: '44444444-4444-4444-4444-444444444444',
      }),
    );
  });

  it('keeps owner checkout scoped to the JWT tenant', async () => {
    await request(app.getHttpServer())
      .post('/checkouts')
      .set(
        'Authorization',
        `Bearer ${jwt('owner', '11111111-1111-1111-1111-111111111111')}`,
      )
      .send({
        tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        storeId: '22222222-2222-2222-2222-222222222222',
        customerId: '33333333-3333-3333-3333-333333333333',
        productId: '44444444-4444-4444-4444-444444444444',
      })
      .expect(403);

    expect(checkouts.create).not.toHaveBeenCalled();
  });

  it('lets staff create a checkout for another tenant', async () => {
    const targetTenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const targetStore = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    await request(app.getHttpServer())
      .post('/checkouts')
      .set(
        'Authorization',
        `Bearer ${jwt('staff', '99999999-9999-9999-9999-999999999999')}`,
      )
      .send({
        tenantId: targetTenant,
        storeId: targetStore,
        customerId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        productId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      })
      .expect(201);

    expect(checkouts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: targetTenant,
        storeId: targetStore,
        customerId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        productId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      }),
    );
  });

  it('lets staff mint via POST /staff/checkouts for another tenant', async () => {
    const targetTenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await request(app.getHttpServer())
      .post('/staff/checkouts')
      .set(
        'Authorization',
        `Bearer ${jwt('staff', '99999999-9999-9999-9999-999999999999')}`,
      )
      .send({
        tenantId: targetTenant,
        storeId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        customerId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        productId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      })
      .expect(201);

    expect(checkouts.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: targetTenant }),
    );
  });

  it('forbids owner from POST /staff/checkouts', async () => {
    await request(app.getHttpServer())
      .post('/staff/checkouts')
      .set('Authorization', `Bearer ${jwt('owner')}`)
      .send({
        tenantId: '11111111-1111-1111-1111-111111111111',
        storeId: '22222222-2222-2222-2222-222222222222',
        customerId: '33333333-3333-3333-3333-333333333333',
        productId: '44444444-4444-4444-4444-444444444444',
      })
      .expect(403);

    expect(checkouts.create).not.toHaveBeenCalled();
  });

  it('forbids owner from staff list/contact routes', async () => {
    const token = jwt('owner');
    await request(app.getHttpServer())
      .get('/staff/stores')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/staff/customers')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/staff/customers/c1/contact')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'call' })
      .expect(403);
  });

  it('lets staff list stores/customers and register contact', async () => {
    const token = jwt('staff', '99999999-9999-9999-9999-999999999999');

    await request(app.getHttpServer())
      .get('/staff/stores')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/staff/customers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/staff/customers/c1/contact')
      .set('Authorization', `Bearer ${token}`)
      .send({
        channel: 'call',
        occurredAt: '2026-08-31T10:00:00.000Z',
        note: 'Falou com a cliente',
      })
      .expect(201);

    expect(staff.registerContact).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        staffUserId: 'user-staff',
        channel: 'call',
        occurredAt: '2026-08-31T10:00:00.000Z',
      }),
    );
  });

  it('lets staff create a campaign for another tenant', async () => {
    const targetTenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const targetStore = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    await request(app.getHttpServer())
      .post('/campaigns')
      .set(
        'Authorization',
        `Bearer ${jwt('staff', '99999999-9999-9999-9999-999999999999')}`,
      )
      .send({
        tenantId: targetTenant,
        storeId: targetStore,
        name: 'Recuperação',
        segment: 'interesse_aberto',
        messageTemplate: 'Oi {{nome}}, ainda tem interesse?',
      })
      .expect(201);

    expect(campaigns.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: targetTenant,
        storeId: targetStore,
      }),
    );
  });
});
