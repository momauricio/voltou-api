import {
  buildPaidLines,
  UnknownCheckoutAddonError,
} from './build-paid-lines';
import type { CheckoutAddon } from './checkout-addons';

const addonA: CheckoutAddon = {
  id: 'addon-a',
  productId: 'prod-addon-a',
  productNameSnapshot: 'Addon A',
  listPriceCents: 5000,
  discountBps: 2000,
  selectedByDefault: false,
};

const base = {
  productId: 'prod-main',
  productNameSnapshot: 'Principal',
  listPriceCents: 10000,
  discountBps: 2000,
  addons: [addonA] as CheckoutAddon[],
  caps: { oneProductBps: 1000, twoOrMoreBps: 1500 },
  commissionRateBps: 500,
};

describe('buildPaidLines', () => {
  it('principal only uses oneProductBps clamp', () => {
    const result = buildPaidLines({
      ...base,
      selectedAddonIds: [],
    });

    expect(result.maxBps).toBe(1000);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      kind: 'principal',
      discountBps: 1000,
      amountCents: 9000,
    });
    expect(result.total).toBe(9000);
  });

  it('principal + 1 addon uses twoOrMoreBps clamp on both lines', () => {
    const result = buildPaidLines({
      ...base,
      selectedAddonIds: ['addon-a'],
    });

    expect(result.maxBps).toBe(1500);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({
      kind: 'principal',
      discountBps: 1500,
      amountCents: 8500,
    });
    expect(result.lines[1]).toMatchObject({
      kind: 'addon',
      addonId: 'addon-a',
      discountBps: 1500,
      amountCents: 4250,
    });
    expect(result.total).toBe(12750);
  });

  it('unknown selectedAddonId throws UnknownCheckoutAddonError', () => {
    expect(() =>
      buildPaidLines({
        ...base,
        selectedAddonIds: ['not-real'],
      }),
    ).toThrow(UnknownCheckoutAddonError);

    try {
      buildPaidLines({
        ...base,
        selectedAddonIds: ['not-real'],
      });
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownCheckoutAddonError);
      expect((e as UnknownCheckoutAddonError).addonId).toBe('not-real');
      expect((e as Error).message).toContain('not-real');
    }
  });

  it('commission cents = round(total * rateBps / 10000) at rate 500', () => {
    // principal only: amount 9000 → commission = round(9000 * 500 / 10000) = 450
    const principalOnly = buildPaidLines({
      ...base,
      selectedAddonIds: [],
      commissionRateBps: 500,
    });
    expect(principalOnly.total).toBe(9000);
    expect(principalOnly.commissionCents).toBe(450);

    // multi: total 12750 → round(12750 * 500 / 10000) = 638
    const multi = buildPaidLines({
      ...base,
      selectedAddonIds: ['addon-a'],
      commissionRateBps: 500,
    });
    expect(multi.total).toBe(12750);
    expect(multi.commissionCents).toBe(Math.round((12750 * 500) / 10000));
    expect(multi.commissionCents).toBe(638);
  });
});
