import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createHmac } from 'crypto';
import request from 'supertest';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';

describe('WhatsApp webhook (http)', () => {
  let app: INestApplication | undefined;
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
  const keys = [
    'NODE_ENV',
    'WHATSAPP_HOOK_HMAC_KEY',
    'WAHA_WEBHOOK_SECRET',
    'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  ];
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    process.env.NODE_ENV = 'test';
  });

  async function boot(withThrottler = false) {
    const moduleRef = await Test.createTestingModule({
      imports: withThrottler
        ? [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 2 }] })]
        : [],
      controllers: [WhatsAppController],
      providers: [
        { provide: WhatsAppService, useValue: whatsapp },
        ...(withThrottler ? [{ provide: APP_GUARD, useClass: ThrottlerGuard }] : []),
      ],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    return app;
  }

  afterEach(async () => {
    jest.clearAllMocks();
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    if (app) await app.close();
    app = undefined;
  });

  const payload = { event: 'message', session: 'default' };
  const raw = JSON.stringify(payload);
  const sign = (secret: string, body = raw) =>
    createHmac('sha512', secret).update(body).digest('hex');
  const post = (a: INestApplication) =>
    request(a.getHttpServer())
      .post('/whatsapp/webhook')
      .set('Content-Type', 'application/json');

  describe('POST /whatsapp/webhook', () => {
    it('returns 401 in production when the shared HMAC secret is missing', async () => {
      process.env.NODE_ENV = 'production';
      const a = await boot();

      await request(a.getHttpServer())
        .post('/whatsapp/webhook')
        .send({ event: 'message' })
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toBe('Webhook WhatsApp sem segredo configurado.');
        });
      expect(whatsapp.handleWebhook).not.toHaveBeenCalled();
    });

    it('forwards the body outside production when no secret is configured', async () => {
      const a = await boot();

      await request(a.getHttpServer())
        .post('/whatsapp/webhook')
        .send(payload)
        .expect(201);

      expect(whatsapp.handleWebhook).toHaveBeenCalledWith(payload);
    });

    it('accepts a valid HMAC-SHA512 of the raw body', async () => {
      process.env.WHATSAPP_HOOK_HMAC_KEY = 'shared-secret';
      const a = await boot();

      await post(a).set('X-Webhook-Hmac', sign('shared-secret')).send(raw).expect(201);
      expect(whatsapp.handleWebhook).toHaveBeenCalledWith(payload);
    });

    it('accepts a valid HMAC with X-Webhook-Hmac-Algorithm: sha512', async () => {
      process.env.WHATSAPP_HOOK_HMAC_KEY = 'shared-secret';
      const a = await boot();

      await post(a)
        .set('X-Webhook-Hmac', sign('shared-secret'))
        .set('X-Webhook-Hmac-Algorithm', 'SHA512')
        .send(raw)
        .expect(201);
      expect(whatsapp.handleWebhook).toHaveBeenCalledWith(payload);
    });

    it('accepts WAHA_WEBHOOK_SECRET when WHATSAPP_HOOK_HMAC_KEY is unset', async () => {
      process.env.WAHA_WEBHOOK_SECRET = 'alias-secret';
      const a = await boot();

      await post(a).set('X-Webhook-Hmac', sign('alias-secret')).send(raw).expect(201);
      expect(whatsapp.handleWebhook).toHaveBeenCalledWith(payload);
    });

    it('returns 401 when HMAC does not match', async () => {
      process.env.WHATSAPP_HOOK_HMAC_KEY = 'shared-secret';
      const a = await boot();

      await post(a)
        .set('X-Webhook-Hmac', 'nope')
        .send(raw)
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toBe('Assinatura do webhook WhatsApp inválida.');
        });
      expect(whatsapp.handleWebhook).not.toHaveBeenCalled();
    });

    it('returns 401 without a signature header', async () => {
      process.env.WHATSAPP_HOOK_HMAC_KEY = 'shared-secret';
      const a = await boot();

      await post(a).send(raw).expect(401);
      expect(whatsapp.handleWebhook).not.toHaveBeenCalled();
    });

    it('returns 401 when signed with another secret', async () => {
      process.env.WHATSAPP_HOOK_HMAC_KEY = 'shared-secret';
      const a = await boot();

      await post(a).set('X-Webhook-Hmac', sign('other-secret')).send(raw).expect(401);
      expect(whatsapp.handleWebhook).not.toHaveBeenCalled();
    });

    it('returns 401 when the declared algorithm is not sha512', async () => {
      process.env.WHATSAPP_HOOK_HMAC_KEY = 'shared-secret';
      const a = await boot();

      await post(a)
        .set('X-Webhook-Hmac', sign('shared-secret'))
        .set('X-Webhook-Hmac-Algorithm', 'sha256')
        .send(raw)
        .expect(401);
      expect(whatsapp.handleWebhook).not.toHaveBeenCalled();
    });

    it('is not rate limited by the global ThrottlerGuard', async () => {
      process.env.WHATSAPP_HOOK_HMAC_KEY = 'shared-secret';
      const a = await boot(true);

      for (let i = 0; i < 5; i++) {
        await post(a).set('X-Webhook-Hmac', sign('shared-secret')).send(raw).expect(201);
      }
      expect(whatsapp.handleWebhook).toHaveBeenCalledTimes(5);
    });
  });

  describe('GET /whatsapp/webhook (Meta-style verification)', () => {
    const verify = (a: INestApplication, query: Record<string, string>) =>
      request(a.getHttpServer()).get('/whatsapp/webhook').query(query);

    it('echoes the challenge as text/plain with the right token', async () => {
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'verify-me';
      const a = await boot();

      const res = await verify(a, {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'verify-me',
        'hub.challenge': 'abc_123-XYZ',
      }).expect(200);
      expect(res.text).toBe('abc_123-XYZ');
      expect(res.headers['content-type']).toMatch(/^text\/plain/);
    });

    it('returns 403 with a wrong token', async () => {
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'verify-me';
      const a = await boot();

      await verify(a, {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong',
        'hub.challenge': 'abc',
      }).expect(403);
    });

    it('returns 403 when mode is not subscribe', async () => {
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'verify-me';
      const a = await boot();

      await verify(a, {
        'hub.mode': 'unsubscribe',
        'hub.verify_token': 'verify-me',
        'hub.challenge': 'abc',
      }).expect(403);
    });

    it('returns 403 when the verify token env is not configured', async () => {
      const a = await boot();

      await verify(a, {
        'hub.mode': 'subscribe',
        'hub.verify_token': '',
        'hub.challenge': 'abc',
      }).expect(403);
    });

    it('returns 403 when the challenge has invalid characters', async () => {
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'verify-me';
      const a = await boot();

      await verify(a, {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'verify-me',
        'hub.challenge': '<script>alert(1)</script>',
      })
        .expect(403)
        .expect((res) => {
          expect(res.body.message).toBe('Verificação do webhook WhatsApp inválida.');
        });
    });
  });
});
