import { UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const value =
    headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * WAHA signs the raw POST body with HMAC-SHA512 and sends X-Webhook-Hmac.
 * Secret: WHATSAPP_HOOK_HMAC_KEY (main.ts may load it from
 * /app/.whatsapp-hook-hmac-key) or WAHA_WEBHOOK_SECRET.
 */
export function assertWhatsAppWebhookHmac({
  headers,
  rawBody,
}: {
  headers?: Record<string, string | string[] | undefined>;
  rawBody?: unknown;
}): void {
  const secret = (
    process.env.WHATSAPP_HOOK_HMAC_KEY ||
    process.env.WAHA_WEBHOOK_SECRET ||
    ''
  ).trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production')
      throw new UnauthorizedException(
        'Webhook WhatsApp sem segredo configurado.',
      );
    return;
  }
  if (!Buffer.isBuffer(rawBody))
    throw new UnauthorizedException('Assinatura do webhook WhatsApp inválida.');
  const provided = String(headerValue(headers, 'x-webhook-hmac') || '').trim();
  const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new UnauthorizedException('Assinatura do webhook WhatsApp inválida.');
}
