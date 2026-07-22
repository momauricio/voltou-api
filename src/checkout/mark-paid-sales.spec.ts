import {
  expectedPaidLines,
  findMissingPaidLines,
} from './mark-paid-sales';

describe('expectedPaidLines', () => {
  it('uses paidLinesJson when present', () => {
    const lines = expectedPaidLines({
      paidLinesJson: JSON.stringify([
        {
          kind: 'principal',
          productId: 'p1',
          productNameSnapshot: 'A',
          listPriceCents: 1000,
          discountBps: 0,
          amountCents: 1000,
        },
        {
          kind: 'addon',
          productId: 'p2',
          productNameSnapshot: 'B',
          listPriceCents: 500,
          discountBps: 0,
          amountCents: 500,
        },
      ]),
      productId: 'p1',
      productNameSnapshot: 'A',
      listPriceCents: 1000,
      amountCents: 1500,
      discountBps: 0,
    });
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.productId)).toEqual(['p1', 'p2']);
  });

  it('falls back to principal checkout fields', () => {
    const lines = expectedPaidLines({
      paidLinesJson: null,
      productId: 'p1',
      productNameSnapshot: 'A',
      listPriceCents: 1000,
      amountCents: 900,
      discountBps: 1000,
    });
    expect(lines).toEqual([
      {
        kind: 'principal',
        productId: 'p1',
        productNameSnapshot: 'A',
        listPriceCents: 1000,
        discountBps: 1000,
        amountCents: 900,
      },
    ]);
  });
});

describe('findMissingPaidLines', () => {
  const expected = [
    {
      kind: 'principal' as const,
      productId: 'p1',
      productNameSnapshot: 'A',
      listPriceCents: 1000,
      discountBps: 0,
      amountCents: 1000,
    },
    {
      kind: 'addon' as const,
      productId: 'p2',
      productNameSnapshot: 'B',
      listPriceCents: 500,
      discountBps: 0,
      amountCents: 500,
    },
  ];

  it('returns all when no sales exist', () => {
    expect(findMissingPaidLines(expected, [])).toHaveLength(2);
  });

  it('returns only unmatched lines after partial insert', () => {
    const missing = findMissingPaidLines(expected, [
      { productId: 'p1', amountCents: 1000 },
    ]);
    expect(missing).toHaveLength(1);
    expect(missing[0].productId).toBe('p2');
  });

  it('returns empty when complete', () => {
    expect(
      findMissingPaidLines(expected, [
        { productId: 'p1', amountCents: 1000 },
        { productId: 'p2', amountCents: 500 },
      ]),
    ).toHaveLength(0);
  });
});
