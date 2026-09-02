import { googleAuthSchema, loginSchema, registerSchema } from './schemas';

const validRegister = {
  ownerName: 'Maria Silva',
  storeName: 'Loja da Maria',
  cnpj: '11.222.333/0001-81',
  email: 'maria@loja.test',
  password: 'secret123',
  ownerPhone: '11987654321',
};

describe('registerSchema (lojista)', () => {
  it('rejects missing phone', () => {
    const { ownerPhone: _, ...withoutPhone } = validRegister;
    const parsed = registerSchema.safeParse(withoutPhone);
    expect(parsed.success).toBe(false);
  });

  it('rejects invalid / landline phone', () => {
    const parsed = registerSchema.safeParse({
      ...validRegister,
      ownerPhone: '1133334444',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts national digits and stores E.164 (does not require +55 in payload)', () => {
    const parsed = registerSchema.parse(validRegister);
    expect(parsed.ownerPhoneE164).toBe('+5511987654321');
    expect(parsed.email).toBe('maria@loja.test');
    expect(parsed.password).toBe('secret123');
    expect(parsed.cnpj).toBe('11222333000181');
  });

  it('accepts ownerPhoneE164 alias in national or E.164 form', () => {
    const { ownerPhone: _, ...rest } = validRegister;
    expect(
      registerSchema.parse({ ...rest, ownerPhoneE164: '11987654321' })
        .ownerPhoneE164,
    ).toBe('+5511987654321');
    expect(
      registerSchema.parse({ ...rest, ownerPhoneE164: '+5511987654321' })
        .ownerPhoneE164,
    ).toBe('+5511987654321');
  });
});

describe('loginSchema', () => {
  it('keeps email+password path', () => {
    const parsed = loginSchema.parse({
      email: 'maria@loja.test',
      password: 'secret123',
    });
    expect(parsed.password).toBe('secret123');
    expect(parsed.email ?? parsed.identifier).toMatch(/maria@loja.test/i);
  });

  it('allows identifier as national or E.164 phone', () => {
    expect(
      loginSchema.parse({ identifier: '11987654321', password: 'secret123' })
        .identifier,
    ).toBe('11987654321');
    expect(
      loginSchema.parse({
        identifier: '+5511987654321',
        password: 'secret123',
      }).identifier,
    ).toBe('+5511987654321');
  });
});

describe('googleAuthSchema', () => {
  it('requires idToken', () => {
    expect(googleAuthSchema.safeParse({}).success).toBe(false);
    expect(googleAuthSchema.parse({ idToken: 'google-id-token-value' }).idToken)
      .toBe('google-id-token-value');
  });
});
