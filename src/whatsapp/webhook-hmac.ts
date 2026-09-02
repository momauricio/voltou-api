import { UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

/** WAHA documents WHATSAPP_HOOK_HMAC_KEY; WAHA_WEBHOOK_SECRET is an alias. */
export function resolveWhatsAppWebhookSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.WHATSAPP_HOOK_HMAC_KEY?.trim() ||
    env.WAHA_WEBHOOK_SECRET?.trim() ||
    ''
  );
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const key = Object.keys(headers).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (!key) return undefined;
  const v = headers[key];
  return Array.isArray(v) ? v[0] : v;
}

function safeEqualHex(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * WAHA signs the raw POST body with HMAC-SHA512 and sends X-Webhook-Hmac.
 * Production requires a shared secret; unsigned notifications are refused.
 */
export function assertWhatsAppWebhookHmac(input: {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer | string | null;
  env?: NodeJS.ProcessEnv;
}): void {
  const env = input.env ?? process.env;
  const secret = resolveWhatsAppWebhookSecret(env);
  const isProd = (env.NODE_ENV ?? '').toLowerCase() === 'production';

  if (!secret) {
    if (isProd) {
      throw new UnauthorizedException(
        'Webhook WhatsApp sem segredo compartilhado.',
      );
    }
    return;
  }

  const provided = headerValue(input.headers, 'x-webhook-hmac');
  if (!provided) {
    throw new UnauthorizedException('Assinatura HMAC do webhook ausente.');
  }

  if (input.rawBody == null) {
    throw new UnauthorizedException('Corpo bruto do webhook ausente.');
  }

  const raw =
    typeof input.rawBody === 'string'
      ? Buffer.from(input.rawBody)
      : input.rawBody;
  const expected = createHmac('sha512', secret).update(raw).digest('hex');
  if (!safeEqualHex(expected, provided)) {
    throw new UnauthorizedException('Assinatura HMAC do webhook inválida.');
  }
}
