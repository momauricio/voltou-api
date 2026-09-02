const PUBLIC_DEFAULT = 'voltou-dev-secret-change-me';
const MIN_LENGTH = 32;

export const AUTH_SECRET_UNSAFE_MESSAGE =
  'AUTH_SECRET ausente ou inseguro. Defina AUTH_SECRET com um valor longo e aleatório (ex.: openssl rand -base64 48).';

function normalizeAuthSecret(raw: string | undefined): string {
  return raw?.trim() ?? '';
}

function isUnsafeAuthSecret(raw: string | undefined): boolean {
  const secret = normalizeAuthSecret(raw);
  if (!secret) return true;
  if (secret.toLowerCase() === PUBLIC_DEFAULT) return true;
  if (secret.length < MIN_LENGTH) return true;
  return false;
}

/** Fail-fast at process boot. Does not print the secret. */
export function assertAuthSecret(raw = process.env.AUTH_SECRET): void {
  if (isUnsafeAuthSecret(raw)) {
    throw new Error(AUTH_SECRET_UNSAFE_MESSAGE);
  }
}

/** Read AUTH_SECRET after bootstrap assert. Throws if somehow missing. */
export function getAuthSecret(): string {
  const secret = normalizeAuthSecret(process.env.AUTH_SECRET);
  if (!secret) {
    throw new Error(AUTH_SECRET_UNSAFE_MESSAGE);
  }
  return secret;
}
