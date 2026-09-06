import { BadRequestException } from '@nestjs/common';

export const TRACKING_CODE_MAX = 120;

const PICKUP = new Set(['pickup', 'retirada']);
const DELIVERY = new Set(['delivery', 'home', 'entrega']);

export function normalizeTrackingCode(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > TRACKING_CODE_MAX) {
    throw new BadRequestException(
      `Código de rastreio deve ter no máximo ${TRACKING_CODE_MAX} caracteres.`,
    );
  }
  return trimmed;
}

export function isPickupFulfillment(method?: string | null): boolean {
  const v = method?.trim().toLowerCase();
  return Boolean(v && PICKUP.has(v));
}

export function isHomeDeliveryFulfillment(method?: string | null): boolean {
  const v = method?.trim().toLowerCase();
  return Boolean(v && DELIVERY.has(v));
}

/**
 * Tracking is for home delivery. Reject explicit pickup/retirada.
 * Unknown/null is allowed until payment persists fulfillmentMethod
 * (that write path is not on this branch).
 */
export function assertTrackingAllowed(method?: string | null): void {
  if (isPickupFulfillment(method)) {
    throw new BadRequestException(
      'Código de rastreio só pode ser informado em pedidos de entrega.',
    );
  }
}
