import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, SCRYPT_KEYLEN);
  const prev = Buffer.from(hash, 'hex');
  if (prev.length !== next.length) return false;
  return timingSafeEqual(prev, next);
}

export function createToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function signAccessToken(payload: Record<string, unknown>): string {
  const secret = process.env.AUTH_SECRET ?? 'voltou-dev-secret-change-me';
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  })).toString('base64url');
  const sig = createHash('sha256').update(`${body}.${secret}`).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyAccessToken(
  token: string,
): { sub: string; tenantId: string; email: string; role: string } | null {
  const secret = process.env.AUTH_SECRET ?? 'voltou-dev-secret-change-me';
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHash('sha256')
    .update(`${body}.${secret}`)
    .digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as {
      sub?: string;
      tenantId?: string;
      email?: string;
      role?: string;
      exp?: number;
    };
    if (!payload.sub || !payload.tenantId || !payload.email) return null;
    if (payload.exp != null && payload.exp < Date.now()) return null;
    return {
      sub: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      role: payload.role ?? 'owner',
    };
  } catch {
    return null;
  }
}

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}
