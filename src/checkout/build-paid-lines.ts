import type { CheckoutAddon, PaidLine } from './checkout-addons';
import {
  clampDiscountBps,
  effectiveLineAmountCents,
} from './discount-caps';

export class UnknownCheckoutAddonError extends Error {
  constructor(public readonly addonId: string) {
    super(`Add-on inválido ou não disponível nesta oferta: ${addonId}`);
    this.name = 'UnknownCheckoutAddonError';
  }
}

export type BuildPaidLinesInput = {
  productId: string;
  productNameSnapshot: string;
  listPriceCents: number;
  discountBps: number;
  addons: CheckoutAddon[];
  selectedAddonIds: string[];
  caps: { oneProductBps: number; twoOrMoreBps: number };
  commissionRateBps: number;
};

export type BuildPaidLinesResult = {
  lines: PaidLine[];
  total: number;
  commissionCents: number;
  maxBps: number;
};

/** Pure pay-path line builder: cap switch, clamp, total, commission. */
export function buildPaidLines(
  input: BuildPaidLinesInput,
): BuildPaidLinesResult {
  const knownAddonIds = new Set(input.addons.map((a) => a.id));
  for (const id of input.selectedAddonIds) {
    if (!knownAddonIds.has(id)) {
      throw new UnknownCheckoutAddonError(id);
    }
  }

  const selected = input.addons.filter((a) =>
    input.selectedAddonIds.includes(a.id),
  );
  const multi = selected.length >= 1;
  const maxBps = multi ? input.caps.twoOrMoreBps : input.caps.oneProductBps;

  const principalBps = clampDiscountBps(input.discountBps, maxBps);
  const lines: PaidLine[] = [
    {
      kind: 'principal',
      productId: input.productId,
      productNameSnapshot: input.productNameSnapshot,
      listPriceCents: input.listPriceCents,
      discountBps: principalBps,
      amountCents: effectiveLineAmountCents(input.listPriceCents, principalBps),
    },
    ...selected.map((a) => {
      const bps = clampDiscountBps(a.discountBps, maxBps);
      return {
        kind: 'addon' as const,
        addonId: a.id,
        productId: a.productId,
        productNameSnapshot: a.productNameSnapshot,
        listPriceCents: a.listPriceCents,
        discountBps: bps,
        amountCents: effectiveLineAmountCents(a.listPriceCents, bps),
      };
    }),
  ];

  const total = lines.reduce((s, l) => s + l.amountCents, 0);
  const commissionCents = Math.round(
    (total * input.commissionRateBps) / 10000,
  );

  return { lines, total, commissionCents, maxBps };
}
