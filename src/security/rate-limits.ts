/** Per-IP windows for public auth and public pay (ttl is milliseconds). */
export const RATE_LIMIT_TTL_MS = 60_000;

export const LOGIN_PER_MIN = 10;
export const REGISTER_PER_MIN = 5;
export const CNPJ_STATUS_PER_MIN = 5;
export const PUBLIC_PAY_PER_MIN = 10;

export const loginThrottle = {
  default: { limit: LOGIN_PER_MIN, ttl: RATE_LIMIT_TTL_MS },
} as const;

export const registerThrottle = {
  default: { limit: REGISTER_PER_MIN, ttl: RATE_LIMIT_TTL_MS },
} as const;

export const cnpjStatusThrottle = {
  default: { limit: CNPJ_STATUS_PER_MIN, ttl: RATE_LIMIT_TTL_MS },
} as const;

export const publicPayThrottle = {
  default: { limit: PUBLIC_PAY_PER_MIN, ttl: RATE_LIMIT_TTL_MS },
} as const;
