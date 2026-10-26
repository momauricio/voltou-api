import {
  computePaymentAmounts,
  resolveShippingCents,
  parseShippingAddress,
  assertFulfillmentTransition,
} from './fulfillment';

describe('resolveShippingCents', () => {
  it('pickup always 0', () => {
    expect(resolveShippingCents('pickup', 1500)).toBe(0);
  });
  it('delivery uses store fixed fee', () => {
    expect(resolveShippingCents('delivery', 1500)).toBe(1500);
  });
});

describe('computePaymentAmounts', () => {
  it('charges products+shipping but commissions products only', () => {
    const r = computePaymentAmounts(10_000, 1_500, 500);
    expect(r.chargeCents).toBe(11_500);
    expect(r.commissionCents).toBe(500); // 5% of 10000
  });
  it('pickup: charge equals products', () => {
    const r = computePaymentAmounts(10_000, 0, 500);
    expect(r.chargeCents).toBe(10_000);
    expect(r.commissionCents).toBe(500);
  });
});

describe('parseShippingAddress', () => {
  const valid = {
    recipientName: 'Marina Silva',
    phoneE164: '+5511999999999',
    cep: '01310100',
    street: 'Av Paulista',
    number: '1000',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
  };
  it('accepts valid address', () => {
    expect(parseShippingAddress(valid).city).toBe('São Paulo');
  });
  it('rejects missing street', () => {
    expect(() => parseShippingAddress({ ...valid, street: '' })).toThrow(/rua/i);
  });
  it('normalizes CEP digits', () => {
    expect(parseShippingAddress({ ...valid, cep: '01310-100' }).cep).toBe('01310100');
  });
});

describe('assertFulfillmentTransition', () => {
  it('allows pickup awaiting→ready→done', () => {
    expect(() => assertFulfillmentTransition('pickup', 'awaiting', 'ready')).not.toThrow();
    expect(() => assertFulfillmentTransition('pickup', 'ready', 'done')).not.toThrow();
  });
  it('allows awaiting→done shortcut', () => {
    expect(() => assertFulfillmentTransition('delivery', 'awaiting', 'done')).not.toThrow();
  });
  it('rejects pickup shipped', () => {
    expect(() => assertFulfillmentTransition('pickup', 'awaiting', 'shipped')).toThrow();
  });
});
