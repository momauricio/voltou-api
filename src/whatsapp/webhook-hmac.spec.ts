import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { assertWhatsAppWebhookHmac } from './webhook-hmac';

describe('WhatsApp webhook HMAC (prod behavior)', () => {
  const secret = 'waha-shared-hmac-key';
  const rawBody = Buffer.from('{"event":"message","session":"default"}');
  const keys = ['NODE_ENV', 'WHATSAPP_HOOK_HMAC_KEY', 'WAHA_WEBHOOK_SECRET'];
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it('refuses in production when no secret is configured', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertWhatsAppWebhookHmac({ headers: {}, rawBody })).toThrow(
      'Webhook WhatsApp sem segredo configurado.',
    );
  });

  it('allows unsigned notifications outside production when no secret is set', () => {
    process.env.NODE_ENV = 'development';
    expect(() =>
      assertWhatsAppWebhookHmac({ headers: {}, rawBody }),
    ).not.toThrow();
  });

  it('rejects when rawBody is not a Buffer (the prod controller never has one)', () => {
    process.env.WHATSAPP_HOOK_HMAC_KEY = secret;
    expect(() =>
      assertWhatsAppWebhookHmac({ headers: {}, rawBody: undefined }),
    ).toThrow('Assinatura do webhook WhatsApp inválida.');
  });

  it('rejects a missing or invalid HMAC when a secret is configured', () => {
    process.env.WHATSAPP_HOOK_HMAC_KEY = secret;
    expect(() => assertWhatsAppWebhookHmac({ headers: {}, rawBody })).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      assertWhatsAppWebhookHmac({
        headers: { 'x-webhook-hmac': 'deadbeef' },
        rawBody,
      }),
    ).toThrow('Assinatura do webhook WhatsApp inválida.');
  });

  it('accepts a valid SHA-512 HMAC of the raw body (WAHA_WEBHOOK_SECRET alias)', () => {
    process.env.WAHA_WEBHOOK_SECRET = ` ${secret} `;
    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    expect(() =>
      assertWhatsAppWebhookHmac({
        headers: { 'x-webhook-hmac': expected },
        rawBody,
      }),
    ).not.toThrow();
  });
});
