import { parseBrMobileE164 } from './phone.util';

describe('parseBrMobileE164 (lojista WhatsApp identity)', () => {
  it('normalizes national 11-digit mobile (third digit 9) to E.164', () => {
    expect(parseBrMobileE164('11987654321')).toBe('+5511987654321');
    expect(parseBrMobileE164('(11) 98765-4321')).toBe('+5511987654321');
  });

  it('accepts E.164 or 55-prefixed digits without requiring +55 from the client', () => {
    expect(parseBrMobileE164('+5511987654321')).toBe('+5511987654321');
    expect(parseBrMobileE164('5511987654321')).toBe('+5511987654321');
  });

  it('rejects missing, landline, and non-mobile numbers', () => {
    expect(parseBrMobileE164(undefined)).toBeNull();
    expect(parseBrMobileE164('')).toBeNull();
    expect(parseBrMobileE164('1133334444')).toBeNull();
    expect(parseBrMobileE164('11333344441')).toBeNull();
    expect(parseBrMobileE164('123')).toBeNull();
  });
});
