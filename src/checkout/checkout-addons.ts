export type CheckoutAddon = {
  id: string;
  productId: string;
  productNameSnapshot: string;
  listPriceCents: number;
  discountBps: number;
  selectedByDefault: boolean;
};

export type PaidLine = {
  kind: 'principal' | 'addon';
  addonId?: string;
  productId: string;
  productNameSnapshot: string;
  listPriceCents: number;
  discountBps: number;
  amountCents: number;
};

export function parseAddonsJson(raw: string | null | undefined): CheckoutAddon[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as CheckoutAddon[]) : [];
  } catch {
    return [];
  }
}

export function serializeAddons(addons: CheckoutAddon[]): string {
  return JSON.stringify(addons);
}

export function parsePaidLinesJson(raw: string | null | undefined): PaidLine[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as PaidLine[]) : [];
  } catch {
    return [];
  }
}

export function serializePaidLines(lines: PaidLine[]): string {
  return JSON.stringify(lines);
}
