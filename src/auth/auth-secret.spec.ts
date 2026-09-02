import { randomBytes } from 'crypto';
import { assertAuthSecret } from './auth-secret';

describe('assertAuthSecret', () => {
  const original = process.env.AUTH_SECRET;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = original;
    }
  });

  it('rejects missing AUTH_SECRET', () => {
    delete process.env.AUTH_SECRET;
    expect(() => assertAuthSecret()).toThrow(/AUTH_SECRET/);
    expect(() => assertAuthSecret()).toThrow(/longo e aleatório|long random/i);
  });

  it('rejects empty AUTH_SECRET', () => {
    process.env.AUTH_SECRET = '';
    expect(() => assertAuthSecret()).toThrow(/AUTH_SECRET/);
  });

  it('rejects whitespace-only AUTH_SECRET', () => {
    process.env.AUTH_SECRET = '   ';
    expect(() => assertAuthSecret()).toThrow(/AUTH_SECRET/);
  });

  it('rejects the public default voltou-dev-secret-change-me', () => {
    process.env.AUTH_SECRET = 'voltou-dev-secret-change-me';
    expect(() => assertAuthSecret()).toThrow(/AUTH_SECRET/);
    try {
      assertAuthSecret();
    } catch (err) {
      expect((err as Error).message).not.toContain(
        'voltou-dev-secret-change-me',
      );
    }
  });

  it('rejects obvious short placeholders', () => {
    for (const weak of ['secret', 'changeme', 'change-me', 'password', 'dev']) {
      process.env.AUTH_SECRET = weak;
      expect(() => assertAuthSecret()).toThrow(/AUTH_SECRET/);
    }
  });

  it('accepts a long random string', () => {
    process.env.AUTH_SECRET = randomBytes(32).toString('hex');
    expect(() => assertAuthSecret()).not.toThrow();
  });
});
