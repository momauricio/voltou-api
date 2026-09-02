import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import {
  assertWhatsAppWebhookHmac,
  resolveWhatsAppWebhookSecret,
} from './webhook-hmac';

describe('WhatsApp webhook HMAC', () => {
  const secret = 'waha-shared-hmac-key';
  const rawBody = '{"event":"message","session":"default"}';

  it('prefers WHATSAPP_HOOK_HMAC_KEY over the alias', () => {
    expect(
      resolveWhatsAppWebhookSecret({
        WHATSAPP_HOOK_HMAC_KEY: ' primary ',
        WAHA_WEBHOOK_SECRET: 'alias',
      }),
    ).toBe('primary');
  });

  it('falls back to WAHA_WEBHOOK_SECRET', () => {
    expect(
      resolveWhatsAppWebhookSecret({ WAHA_WEBHOOK_SECRET: ' alias ' }),
    ).toBe('alias');
  });

  it('refuses unsigned notifications in production when the secret is missing', () => {
    expect(() =>
      assertWhatsAppWebhookHmac({
        headers: {},
        rawBody,
        env: { NODE_ENV: 'production' },
      }),
    ).toThrow(UnauthorizedException);
  });

  it('allows unsigned notifications outside production when no secret is set', () => {
    expect(() =>
      assertWhatsAppWebhookHmac({
        headers: {},
        rawBody,
        env: { NODE_ENV: 'development' },
      }),
    ).not.toThrow();
  });

  it('rejects a missing or invalid HMAC when a secret is configured', () => {
    const env = { NODE_ENV: 'development', WHATSAPP_HOOK_HMAC_KEY: secret };
    expect(() =>
      assertWhatsAppWebhookHmac({ headers: {}, rawBody, env }),
    ).toThrow(UnauthorizedException);

    expect(() =>
      assertWhatsAppWebhookHmac({
        headers: { 'x-webhook-hmac': 'deadbeef' },
        rawBody,
        env,
      }),
    ).toThrow(UnauthorizedException);
  });

  it('accepts a valid SHA-512 HMAC of the raw body', () => {
    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    expect(() =>
      assertWhatsAppWebhookHmac({
        headers: { 'X-Webhook-Hmac': expected },
        rawBody,
        env: { WHATSAPP_HOOK_HMAC_KEY: secret },
      }),
    ).not.toThrow();
  });
});
