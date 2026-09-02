import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { OffersController } from '../checkout/offers.controller';
import { CheckoutService } from '../checkout/checkout.service';
import {
  CNPJ_STATUS_PER_MIN,
  LOGIN_PER_MIN,
  PUBLIC_PAY_PER_MIN,
  REGISTER_PER_MIN,
} from './rate-limits';

describe('public auth and pay rate limits (http)', () => {
  let app: INestApplication;
  const auth = {
    health: () => ({ module: 'auth', status: 'ok' }),
    register: jest.fn().mockResolvedValue({ email: 'a@b.c' }),
    login: jest.fn().mockResolvedValue({ accessToken: 't' }),
    googleLogin: jest.fn(),
    cnpjStatus: jest.fn().mockResolvedValue({ ok: true, active: true }),
    me: jest.fn(),
    verifyEmail: jest.fn(),
    forgotPassword: jest.fn(),
    changePassword: jest.fn(),
  };
  const checkouts = {
    payPublicOffer: jest.fn().mockResolvedValue({ ok: true }),
    getPublicOffer: jest.fn(),
    getPublicOfferStatus: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        }),
      ],
      controllers: [AuthController, OffersController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: CheckoutService, useValue: checkouts },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it(`returns 429 after ${LOGIN_PER_MIN} login attempts per IP per minute`, async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < LOGIN_PER_MIN; i++) {
      await request(server)
        .post('/auth/login')
        .send({ email: 'maria@loja.test', password: 'secret123' })
        .expect(201);
    }
    await request(server)
      .post('/auth/login')
      .send({ email: 'maria@loja.test', password: 'secret123' })
      .expect(429);
  });

  it(`returns 429 after ${REGISTER_PER_MIN} register attempts per IP per minute`, async () => {
    const server = app.getHttpServer();
    const body = {
      ownerName: 'Maria Silva',
      storeName: 'Loja da Maria',
      cnpj: '11222333000181',
      email: 'maria@loja.test',
      password: 'secret123',
      ownerPhone: '11987654321',
    };
    for (let i = 0; i < REGISTER_PER_MIN; i++) {
      await request(server).post('/auth/register').send(body).expect(201);
    }
    await request(server).post('/auth/register').send(body).expect(429);
  });

  it(`returns 429 after ${CNPJ_STATUS_PER_MIN} cnpj-status lookups per IP per minute`, async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < CNPJ_STATUS_PER_MIN; i++) {
      await request(server)
        .get('/auth/cnpj-status')
        .query({ cnpj: '11222333000181' })
        .expect(200);
    }
    await request(server)
      .get('/auth/cnpj-status')
      .query({ cnpj: '11222333000181' })
      .expect(429);
  });

  it(`returns 429 after ${PUBLIC_PAY_PER_MIN} public offer pays per IP per minute`, async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < PUBLIC_PAY_PER_MIN; i++) {
      await request(server)
        .post('/offers/public/loja-teste/CUPOM1/pay')
        .send({ selectedAddonIds: [] })
        .expect(201);
    }
    await request(server)
      .post('/offers/public/loja-teste/CUPOM1/pay')
      .send({ selectedAddonIds: [] })
      .expect(429);
  });
});
