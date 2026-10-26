import { BadRequestException } from '@nestjs/common';

export const TRACKING_CODE_MAX = 120;

const PICKUP = new Set(['pickup', 'retirada']);
const DELIVERY = new Set(['delivery', 'home', 'entrega']);

export function normalizeTrackingCode(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') {
    throw new BadRequestException('Invalid tracking code');
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > TRACKING_CODE_MAX) {
    throw new BadRequestException(
      `Tracking code exceeds ${TRACKING_CODE_MAX} characters`,
    );
  }
  return trimmed;
}

function normalizeMethod(method: unknown): string | undefined {
  return method == null ? undefined : String(method).trim().toLowerCase();
}

export function isPickupFulfillment(method?: unknown): boolean {
  const v = normalizeMethod(method);
  return !!(v && PICKUP.has(v));
}

export function isHomeDeliveryFulfillment(method?: unknown): boolean {
  const v = normalizeMethod(method);
  return !!(v && DELIVERY.has(v));
}

/**
 * Tracking is for home delivery. Reject explicit pickup/retirada.
 * Unknown/null is allowed (legacy checkouts paid before fulfillmentMethod).
 */
export function assertTrackingAllowed(method?: unknown): void {
  if (isPickupFulfillment(method)) {
    throw new BadRequestException(
      'Tracking code is only allowed for delivery orders',
    );
  }
}
