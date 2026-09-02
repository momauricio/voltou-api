import { signAccessToken, verifyAccessToken } from './crypto.util';

describe('access token secret', () => {
  const original = process.env.AUTH_SECRET;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = original;
    }
  });

  it('does not fall back to a usable default when AUTH_SECRET is missing', () => {
    delete process.env.AUTH_SECRET;
    expect(() =>
      signAccessToken({
        sub: 'u1',
        tenantId: 't1',
        email: 'a@b.c',
        role: 'owner',
      }),
    ).toThrow(/AUTH_SECRET/);
  });

  it('signs and verifies with AUTH_SECRET after it is set', () => {
    process.env.AUTH_SECRET = 'unit-test-auth-secret-not-for-production';
    const token = signAccessToken({
      sub: 'u1',
      tenantId: 't1',
      email: 'a@b.c',
      role: 'owner',
    });
    expect(verifyAccessToken(token)).toMatchObject({
      sub: 'u1',
      tenantId: 't1',
      email: 'a@b.c',
      role: 'owner',
    });
  });
});
