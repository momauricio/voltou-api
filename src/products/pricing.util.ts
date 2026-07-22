/** Desconto máximo padrão quando nem o produto nem a loja definem (30%). */
export const DEFAULT_MAX_DISCOUNT_BPS = 3000;

export type PricingProduct = {
  priceCents: number;
  costCents?: number | null;
  maxDiscountBps?: number | null;
};

/**
 * Piso de venda para a IA: o maior entre
 * (a) preço com o desconto máximo aplicado, e
 * (b) custo "grossed up" pela comissão da Voltou — garante que
 *     (preço de venda - comissão) nunca fica abaixo do custo.
 */
export function priceFloorCents(
  product: PricingProduct,
  commissionRateBps: number,
  storeDefaultMaxDiscountBps: number = DEFAULT_MAX_DISCOUNT_BPS,
): number {
  const maxDiscountBps =
    product.maxDiscountBps ?? storeDefaultMaxDiscountBps;

  const discountFloor = Math.ceil(
    (product.priceCents * (10000 - Math.min(maxDiscountBps, 10000))) / 10000,
  );

  let costFloor = 0;
  if (product.costCents != null && product.costCents > 0) {
    const divisor = 10000 - Math.min(commissionRateBps, 9999);
    costFloor = Math.ceil((product.costCents * 10000) / divisor);
  }

  return Math.min(
    product.priceCents,
    Math.max(discountFloor, costFloor),
  );
}

/** Desconto efetivo máximo (bps) considerando o piso — o que a IA pode dar. */
export function effectiveMaxDiscountBps(
  product: PricingProduct,
  commissionRateBps: number,
  storeDefaultMaxDiscountBps: number = DEFAULT_MAX_DISCOUNT_BPS,
): number {
  if (product.priceCents <= 0) return 0;
  const floor = priceFloorCents(
    product,
    commissionRateBps,
    storeDefaultMaxDiscountBps,
  );
  return Math.max(
    0,
    Math.floor(((product.priceCents - floor) * 10000) / product.priceCents),
  );
}
