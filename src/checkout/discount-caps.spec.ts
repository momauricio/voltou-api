import {
  clampDiscountBps,
  effectiveLineAmountCents,
  getDiscountCapsFromRules,
  parsePercentToBps,
} from './discount-caps';

describe('discount-caps', () => {
  it('parses percent strings to bps', () => {
    expect(parsePercentToBps('15', 10)).toBe(1500);
    expect(parsePercentToBps('10%', 10)).toBe(1000);
  });

  it('uses defaults when rules missing', () => {
    expect(getDiscountCapsFromRules(null)).toEqual({
      oneProductBps: 1000,
      twoOrMoreBps: 1500,
    });
  });

  it('clamps and prices a line', () => {
    expect(clampDiscountBps(2000, 1500)).toBe(1500);
    expect(effectiveLineAmountCents(18900, 1000)).toBe(17010);
  });
});
