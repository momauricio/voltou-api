import { BadRequestException } from '@nestjs/common';
import {
  assertTrackingAllowed,
  normalizeTrackingCode,
  TRACKING_CODE_MAX,
} from './checkout-tracking';

describe('normalizeTrackingCode', () => {
  it('trims free-text and keeps carrier codes as-is (no enum)', () => {
    expect(normalizeTrackingCode('  BR123456789BR  ')).toBe('BR123456789BR');
    expect(normalizeTrackingCode('correios-xyz')).toBe('correios-xyz');
    expect(normalizeTrackingCode('Jadlog 9988')).toBe('Jadlog 9988');
  });

  it('clears empty / whitespace to null', () => {
    expect(normalizeTrackingCode(null)).toBeNull();
    expect(normalizeTrackingCode('')).toBeNull();
    expect(normalizeTrackingCode('   ')).toBeNull();
  });

  it(`rejects codes longer than ${TRACKING_CODE_MAX} characters`, () => {
    expect(() => normalizeTrackingCode('x'.repeat(TRACKING_CODE_MAX + 1))).toThrow(
      BadRequestException,
    );
    expect(normalizeTrackingCode('x'.repeat(TRACKING_CODE_MAX))).toBe(
      'x'.repeat(TRACKING_CODE_MAX),
    );
  });
});

describe('assertTrackingAllowed', () => {
  it('allows delivery / home / entrega', () => {
    expect(() => assertTrackingAllowed('delivery')).not.toThrow();
    expect(() => assertTrackingAllowed('home')).not.toThrow();
    expect(() => assertTrackingAllowed('entrega')).not.toThrow();
    expect(() => assertTrackingAllowed('DELIVERY')).not.toThrow();
  });

  it('rejects pickup / retirada', () => {
    expect(() => assertTrackingAllowed('pickup')).toThrow(BadRequestException);
    expect(() => assertTrackingAllowed('retirada')).toThrow(BadRequestException);
    expect(() => assertTrackingAllowed('PICKUP')).toThrow(BadRequestException);
  });

  it('allows missing fulfillment method until payment persists it', () => {
    expect(() => assertTrackingAllowed(null)).not.toThrow();
    expect(() => assertTrackingAllowed(undefined)).not.toThrow();
    expect(() => assertTrackingAllowed('')).not.toThrow();
  });
});
