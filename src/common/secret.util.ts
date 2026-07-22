import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

function secretKey(): Buffer {
  const raw = process.env.PII_SECRET ?? process.env.AUTH_SECRET ?? 'voltou-dev-pii-secret';
  return createHmac('sha256', 'voltou-pii').update(raw).digest();
}

/** Encrypt opaque secrets (OAuth tokens) with AES-GCM. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, secretKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(blob: string): string {
  const [ivHex, tagHex, dataHex] = blob.split(':');
  const decipher = createDecipheriv(ALGO, secretKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/** Signed OAuth state: tenantId.storeId.nonce.sig */
export function signOAuthState(tenantId: string, storeId: string): string {
  const nonce = randomBytes(12).toString('hex');
  const payload = `${tenantId}.${storeId}.${nonce}`;
  const sig = createHmac('sha256', secretKey()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyOAuthState(
  state: string,
): { tenantId: string; storeId: string } | null {
  const parts = state.split('.');
  if (parts.length !== 4) return null;
  const [tenantId, storeId, nonce, sig] = parts;
  const payload = `${tenantId}.${storeId}.${nonce}`;
  const expected = createHmac('sha256', secretKey()).update(payload).digest('hex');
  if (sig !== expected) return null;
  return { tenantId, storeId };
}
