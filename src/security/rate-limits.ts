/** Per-IP windows for public auth and public pay (ttl is milliseconds). */
export const RATE_LIMIT_TTL_MS = 60000;

export const LOGIN_PER_MIN = 10;
export const REGISTER_PER_MIN = 5;
export const REGISTER = 5;
export const CNPJ_PER_MIN = 5;
export const CNPJ = 5;
export const PUBLIC_PAY_PER_MIN = 10;
export const PUBLIC_PAY = 10;

export const LOGIN_THROTTLE = { default: { limit: 10, ttl: 60000 } };
export const REGISTER_THROTTLE = { default: { limit: 5, ttl: 60000 } };
export const CNPJ_THROTTLE = { default: { limit: 5, ttl: 60000 } };
export const CNPJ_STATUS_THROTTLE = CNPJ_THROTTLE;
export const PUBLIC_PAY_THROTTLE = { default: { limit: 10, ttl: 60000 } };
