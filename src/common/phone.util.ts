import { createHmac, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGO = 'aes-256-gcm';

function secretKey(): Buffer {
  const raw = process.env.PII_SECRET ?? process.env.AUTH_SECRET ?? 'voltou-dev-pii-secret';
  return createHmac('sha256', 'voltou-pii').update(raw).digest();
}

export function hashPhone(e164: string): string {
  return createHmac('sha256', secretKey()).update(e164).digest('hex');
}

export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  const last4 = digits.slice(-4);
  if (digits.length >= 11) {
    const ddd = digits.slice(-11, -9);
    return `(${ddd}) *****-${last4}`;
  }
  return `****-${last4}`;
}

export function encryptPhone(e164: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, secretKey(), iv);
  const enc = Buffer.concat([cipher.update(e164, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptPhone(blob: string): string {
  const [ivHex, tagHex, dataHex] = blob.split(':');
  const decipher = createDecipheriv(ALGO, secretKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/** Normalize BR mobile to E.164 (+55...) when possible. */
export function normalizePhoneBr(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 11) return `+55${digits}`;
  if (input.startsWith('+')) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Lojista (owner) WhatsApp identity: Brazilian mobile only.
 * Accepts national 11 digits (third digit 9) or E.164 / 55-prefixed digits.
 * Never requires the client to send "+55".
 */
export const OWNER_PHONE_MSG =
  'Informe um celular brasileiro com DDD (11 dígitos, nono dígito 9).';
export function parseBrMobileE164(
  input: string | undefined | null,
): string | null {
  if (input == null) return null;
  const digits = input.replace(/\D/g, '');
  if (!digits) return null;

  let national: string;
  if (digits.length === 13 && digits.startsWith('55')) {
    national = digits.slice(2);
  } else if (digits.length === 11) {
    national = digits;
  } else {
    return null;
  }

  // DDD 11–99, subscriber starts with 9 (mobile), then 8 digits.
  if (!/^[1-9]\d9\d{8}$/.test(national)) return null;
  return `+55${national}`;
}
