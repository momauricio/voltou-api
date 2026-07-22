export function parsePercentToBps(
  raw: string | number | undefined | null,
  fallbackPercent: number,
): number {
  if (raw == null || raw === '') {
    return Math.round(fallbackPercent * 100);
  }
  const n =
    typeof raw === 'number'
      ? raw
      : Number(String(raw).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n < 0) return Math.round(fallbackPercent * 100);
  return Math.min(9000, Math.round(n * 100));
}

export function getDiscountCapsFromRules(
  rules: {
    maxDescontoUmProduto?: string;
    maxDescontoDoisOuMais?: string;
  } | null,
): { oneProductBps: number; twoOrMoreBps: number } {
  return {
    oneProductBps: parsePercentToBps(rules?.maxDescontoUmProduto, 10),
    twoOrMoreBps: parsePercentToBps(rules?.maxDescontoDoisOuMais, 15),
  };
}

export function clampDiscountBps(bps: number, maxBps: number): number {
  return Math.max(0, Math.min(bps, maxBps));
}

export function effectiveLineAmountCents(
  listPriceCents: number,
  discountBps: number,
): number {
  return Math.max(
    1,
    Math.round(listPriceCents * (1 - discountBps / 10000)),
  );
}
