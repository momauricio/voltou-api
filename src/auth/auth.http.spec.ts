import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('Auth HTTP (lojista signup)', () => {
  let app: INestApplication;
  const auth = {
    health: () => ({ module: 'auth', status: 'ok' }),
    register: jest.fn(),
    login: jest.fn(),
    googleLogin: jest.fn(),
    cnpjStatus: jest.fn(),
    me: jest.fn(),
    verifyEmail: jest.fn(),
    forgotPassword: jest.fn(),
    changePassword: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
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

  const body = {
    ownerName: 'Maria Silva',
    storeName: 'Loja da Maria',
    cnpj: '11222333000181',
    email: 'maria@loja.test',
    password: 'secret123',
  };

  it('POST /auth/register rejects missing phone', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(body)
      .expect(400);
    expect(auth.register).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).toMatch(/celular|telefone|whatsapp|phone/i);
  });

  it('POST /auth/register rejects invalid phone', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...body, ownerPhone: '1133334444' })
      .expect(400);
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('POST /auth/register accepts national mobile and forwards E.164', async () => {
    auth.register.mockResolvedValue({ email: body.email });
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...body, ownerPhone: '11987654321' })
      .expect(201);
    expect(auth.register).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'maria@loja.test',
        ownerPhoneE164: '+5511987654321',
        password: 'secret123',
        cnpj: '11222333000181',
      }),
    );
  });

  it('GET /auth/cnpj-status returns { ok, active }', async () => {
    auth.cnpjStatus.mockResolvedValue({ ok: true, active: true });
    const res = await request(app.getHttpServer())
      .get('/auth/cnpj-status')
      .query({ cnpj: '11222333000181' })
      .expect(200);
    expect(res.body).toEqual({ ok: true, active: true });
    expect(auth.cnpjStatus).toHaveBeenCalledWith('11222333000181');
  });

  it('POST /auth/google returns 503 when Google is not configured', async () => {
    auth.googleLogin.mockRejectedValue(
      new ServiceUnavailableException(
        'Google login não configurado — defina GOOGLE_CLIENT_ID.',
      ),
    );
    const res = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: 'anything' })
      .expect(503);
    expect(JSON.stringify(res.body)).toMatch(/GOOGLE_CLIENT_ID/);
  });

  it('POST /auth/login still accepts email+password', async () => {
    auth.login.mockResolvedValue({ accessToken: 't' });
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'maria@loja.test', password: 'secret123' })
      .expect(201);
    expect(auth.login).toHaveBeenCalledWith(
      expect.objectContaining({
        password: 'secret123',
      }),
    );
  });
});
