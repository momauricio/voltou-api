import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { RolesGuard } from '../auth/roles.guard';
import { signAccessToken } from '../auth/crypto.util';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { SegmentsService } from './segments.service';

const ownerTenant = '11111111-1111-1111-1111-111111111111';

function ownerJwt() {
  return signAccessToken({
    sub: 'user-owner',
    tenantId: ownerTenant,
    email: 'owner@voltou.test',
    role: 'owner',
  });
}

describe('owner customers (http)', () => {
  let app: INestApplication;
  const prisma = {
    customer: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    customerEvent: { findFirst: jest.fn() },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        CustomersService,
        { provide: SegmentsService, useValue: { compute: jest.fn() } },
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
  });

  it('GET /customers returns phoneMasked and no phoneEnc/phoneHash', async () => {
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'c1',
        displayName: 'Ana',
        phoneMasked: '(11) *****-0001',
        phoneEnc: 'enc-should-not-leak',
        phoneHash: 'hash-should-not-leak',
        customerEvents: [],
        customerInterests: [],
        sales: [],
        checkouts: [],
        outreachMessages: [],
        _count: { sales: 0, customerInterests: 0, checkouts: 0 },
      },
    ]);

    const res = await request(app.getHttpServer())
      .get('/customers')
      .query({ tenantId: ownerTenant, storeId: 'store-1' })
      .set('Authorization', `Bearer ${ownerJwt()}`)
      .expect(200);

    expect(res.body[0].phoneMasked).toBe('(11) *****-0001');
    expect(res.body[0]).not.toHaveProperty('phoneEnc');
    expect(res.body[0]).not.toHaveProperty('phoneHash');
    expect(JSON.stringify(res.body)).not.toMatch(/phoneEnc|phoneHash/);
  });

  it('GET /customers/:id returns phoneMasked and no phoneEnc/phoneHash', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'c1',
      displayName: 'Ana',
      phoneMasked: '(11) *****-0001',
      phoneEnc: 'enc-should-not-leak',
      phoneHash: 'hash-should-not-leak',
      customerInterests: [],
      sales: [],
      checkouts: [],
      customerEvents: [],
      outreachMessages: [],
    });
    prisma.customerEvent.findFirst.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get('/customers/c1')
      .query({ tenantId: ownerTenant })
      .set('Authorization', `Bearer ${ownerJwt()}`)
      .expect(200);

    expect(res.body.phoneMasked).toBe('(11) *****-0001');
    expect(res.body).not.toHaveProperty('phoneEnc');
    expect(res.body).not.toHaveProperty('phoneHash');
    expect(JSON.stringify(res.body)).not.toMatch(/phoneEnc|phoneHash/);
  });
});
