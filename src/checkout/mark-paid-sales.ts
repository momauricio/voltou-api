import { type PaidLine, parsePaidLinesJson } from './checkout-addons';

export type CheckoutSaleLineSource = {
  paidLinesJson: string | null;
  productId: string | null;
  productNameSnapshot: string;
  listPriceCents: number | null;
  amountCents: number;
  discountBps: number;
};

/** Expected paid lines for sale creation (skips entries without productId). */
export function expectedPaidLines(
  checkout: CheckoutSaleLineSource,
): PaidLine[] {
  const lines = parsePaidLinesJson(checkout.paidLinesJson);
  const toCreate =
    lines.length > 0
      ? lines
      : checkout.productId
        ? [
            {
              kind: 'principal' as const,
              productId: checkout.productId,
              productNameSnapshot: checkout.productNameSnapshot,
              listPriceCents: checkout.listPriceCents ?? checkout.amountCents,
              discountBps: checkout.discountBps,
              amountCents: checkout.amountCents,
            },
          ]
        : [];
  return toCreate.filter((line) => Boolean(line.productId));
}

type ExistingSaleKey = { productId: string; amountCents: number };

/**
 * Returns expected lines that do not yet have a matching sale
 * (matched by productId + amountCents, consuming each existing sale once).
 */
export function findMissingPaidLines(
  expected: PaidLine[],
  existing: ExistingSaleKey[],
): PaidLine[] {
  const pool = existing.map((s) => ({ ...s, used: false }));
  const missing: PaidLine[] = [];
  for (const line of expected) {
    const idx = pool.findIndex(
      (s) =>
        !s.used &&
        s.productId === line.productId &&
        s.amountCents === line.amountCents,
    );
    if (idx >= 0) {
      pool[idx].used = true;
    } else {
      missing.push(line);
    }
  }
  return missing;
}
