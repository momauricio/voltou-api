import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';

describe('WhatsApp webhook (http)', () => {
  let app: INestApplication;
  const whatsapp = {
    health: () => ({ module: 'whatsapp', status: 'ok' }),
    handleWebhook: jest.fn().mockResolvedValue({ ok: true }),
    listConnections: jest.fn(),
    createSession: jest.fn(),
    getSession: jest.fn(),
    getQr: jest.fn(),
    disconnect: jest.fn(),
    removeConnection: jest.fn(),
  };
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    WHATSAPP_HOOK_HMAC_KEY: process.env.WHATSAPP_HOOK_HMAC_KEY,
    WAHA_WEBHOOK_SECRET: process.env.WAHA_WEBHOOK_SECRET,
  };

  async function boot() {
    const moduleRef = await Test.createTestingModule({
      controllers: [WhatsAppController],
      providers: [{ provide: WhatsAppService, useValue: whatsapp }],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  }

  afterEach(async () => {
    jest.clearAllMocks();
    if (prev.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev.NODE_ENV;
    if (prev.WHATSAPP_HOOK_HMAC_KEY === undefined) {
      delete process.env.WHATSAPP_HOOK_HMAC_KEY;
    } else {
      process.env.WHATSAPP_HOOK_HMAC_KEY = prev.WHATSAPP_HOOK_HMAC_KEY;
    }
    if (prev.WAHA_WEBHOOK_SECRET === undefined) {
      delete process.env.WAHA_WEBHOOK_SECRET;
    } else {
      process.env.WAHA_WEBHOOK_SECRET = prev.WAHA_WEBHOOK_SECRET;
    }
    if (app) await app.close();
  });

  it('returns 401 in production when the shared HMAC secret is missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.WHATSAPP_HOOK_HMAC_KEY;
    delete process.env.WAHA_WEBHOOK_SECRET;
    await boot();

    await request(app.getHttpServer())
      .post('/whatsapp/webhook')
      .send({ event: 'message' })
      .expect(401);
    expect(whatsapp.handleWebhook).not.toHaveBeenCalled();
  });

  it('returns 401 when HMAC does not match', async () => {
    process.env.NODE_ENV = 'test';
    process.env.WHATSAPP_HOOK_HMAC_KEY = 'shared-secret';
    await boot();

    await request(app.getHttpServer())
      .post('/whatsapp/webhook')
      .set('X-Webhook-Hmac', 'nope')
      .send({ event: 'message' })
      .expect(401);
    expect(whatsapp.handleWebhook).not.toHaveBeenCalled();
  });

  it('accepts a valid HMAC and forwards the body', async () => {
    const secret = 'shared-secret';
    process.env.WHATSAPP_HOOK_HMAC_KEY = secret;
    await boot();

    const payload = { event: 'message', session: 'default' };
    const raw = JSON.stringify(payload);
    const hmac = createHmac('sha512', secret).update(raw).digest('hex');

    await request(app.getHttpServer())
      .post('/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Hmac', hmac)
      .send(raw)
      .expect(201);

    expect(whatsapp.handleWebhook).toHaveBeenCalledWith(payload);
  });
});
