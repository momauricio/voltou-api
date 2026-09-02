import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { hashPassword } from './crypto.util';
import { assertActiveCnpj, getCnpjStatus } from './cnpj.util';
import { getGoogleClientId, verifyGoogleIdToken } from './google-id-token';

jest.mock('./cnpj.util', () => ({
  assertActiveCnpj: jest.fn().mockResolvedValue(undefined),
  getCnpjStatus: jest.fn(),
}));

jest.mock('./google-id-token', () => ({
  getGoogleClientId: jest.fn(() => 'test-google-client-id.apps.googleusercontent.com'),
  verifyGoogleIdToken: jest.fn(),
}));

const mockedAssertCnpj = assertActiveCnpj as jest.MockedFunction<
  typeof assertActiveCnpj
>;
const mockedVerifyGoogle = verifyGoogleIdToken as jest.MockedFunction<
  typeof verifyGoogleIdToken
>;
const mockedGoogleClientId = getGoogleClientId as jest.MockedFunction<
  typeof getGoogleClientId
>;
const mockedGetCnpjStatus = getCnpjStatus as jest.MockedFunction<
  typeof getCnpjStatus
>;

function makePrisma() {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      create: jest.fn(),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(
        async ({
          data,
        }: {
          data: {
            name: string;
            slug: string;
            cnpj: string;
            users: { create: Record<string, unknown> };
            stores: { create: { name: string; slug: string } };
          };
        }) => ({
          id: 'tenant-1',
          name: data.name,
          slug: data.slug,
          cnpj: data.cnpj,
          users: [
            {
              id: 'user-1',
              tenantId: 'tenant-1',
              role: 'owner',
              ...data.users.create,
            },
          ],
          stores: [{ id: 'store-1', name: data.name, slug: data.stores.create.slug }],
        }),
      ),
    },
    store: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
}

const registerInput = {
  ownerName: 'Maria Silva',
  storeName: 'Loja da Maria',
  cnpj: '11222333000181',
  email: 'maria@loja.test',
  password: 'secret123',
  ownerPhoneE164: '+5511987654321',
};

describe('AuthService.register (lojista)', () => {
  const email = { sendVerifyEmail: jest.fn(), sendPasswordReset: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAssertCnpj.mockResolvedValue(undefined);
    process.env.NODE_ENV = 'test';
  });

  it('still calls assertActiveCnpj with the CNPJ digits', async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma as never, email as never);
    await service.register(registerInput);
    expect(mockedAssertCnpj).toHaveBeenCalledWith('11222333000181');
  });

  it('returns 400 when CNPJ is inactive', async () => {
    mockedAssertCnpj.mockRejectedValue(
      new Error('CNPJ precisa estar ativo na Receita Federal.'),
    );
    const prisma = makePrisma();
    const service = new AuthService(prisma as never, email as never);
    await expect(service.register(registerInput)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.register(registerInput)).rejects.toThrow(
      /ativo na Receita/i,
    );
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate owner phone', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) => {
      if (where.ownerPhoneE164 === '+5511987654321') {
        return { id: 'other-user' };
      }
      return null;
    });
    const service = new AuthService(prisma as never, email as never);
    await expect(service.register(registerInput)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it('keeps email unique and email+password path: hashes password and stores E.164 phone', async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma as never, email as never);
    const result = await service.register(registerInput);

    expect(result.email).toBe('maria@loja.test');
    expect(result.requiresEmailVerification).toBe(true);
    expect(email.sendVerifyEmail).toHaveBeenCalled();

    const created = prisma.tenant.create.mock.calls[0][0].data as {
      users: { create: Record<string, unknown> };
    };
    expect(created.users.create.email).toBe('maria@loja.test');
    expect(created.users.create.passwordHash).toEqual(expect.any(String));
    expect(created.users.create.googleSub).toBeUndefined();
    expect(created.users.create.ownerPhoneE164).toBe('+5511987654321');
  });

  it('assigns slugify(storeName) to the store, not hardcoded principal', async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma as never, email as never);
    await service.register(registerInput);
    const created = prisma.tenant.create.mock.calls[0][0].data as {
      stores: { create: { slug: string } };
    };
    expect(created.stores.create.slug).toBe('loja-da-maria');
    expect(created.stores.create.slug).not.toBe('principal');
  });

  it('does not give two tenants named Principal the same store slug', async () => {
    const prisma = makePrisma();
    const taken = new Set<string>();
    prisma.store.findUnique.mockImplementation(
      async ({ where }: { where: { slug?: string } }) =>
        where.slug && taken.has(where.slug)
          ? { id: `s-${where.slug}` }
          : null,
    );
    prisma.tenant.findUnique.mockImplementation(
      async ({ where }: { where: { slug?: string } }) =>
        where.slug && taken.has(where.slug)
          ? { id: `t-${where.slug}` }
          : null,
    );
    prisma.tenant.create.mockImplementation(
      async ({
        data,
      }: {
        data: {
          name: string;
          slug: string;
          cnpj: string;
          users: { create: Record<string, unknown> };
          stores: { create: { name: string; slug: string } };
        };
      }) => {
        taken.add(data.slug);
        taken.add(data.stores.create.slug);
        return {
          id: `tenant-${taken.size}`,
          name: data.name,
          slug: data.slug,
          cnpj: data.cnpj,
          users: [
            {
              id: 'user-1',
              tenantId: 'tenant-1',
              role: 'owner',
              ...data.users.create,
            },
          ],
          stores: [
            { id: 'store-1', name: data.name, slug: data.stores.create.slug },
          ],
        };
      },
    );
    const service = new AuthService(prisma as never, email as never);
    await service.register({ ...registerInput, storeName: 'Principal' });
    await service.register({
      ...registerInput,
      storeName: 'Principal',
      email: 'joao@loja.test',
      ownerPhoneE164: '+5511911111111',
      cnpj: '99888777000166',
    });
    const slugOf = (call: number) =>
      (
        prisma.tenant.create.mock.calls[call][0].data as {
          stores: { create: { slug: string } };
        }
      ).stores.create.slug;
    expect(slugOf(0)).toBe('principal');
    expect(slugOf(1)).toBe('principal-1');
    expect(slugOf(0)).not.toBe(slugOf(1));
  });

  it('suffixes store slug when slugify(storeName) is already taken (including principal)', async () => {
    const prisma = makePrisma();
    prisma.store.findUnique.mockImplementation(
      async ({ where }: { where: { slug?: string } }) => {
        if (where.slug === 'principal') return { id: 'live-loja-teste' };
        return null;
      },
    );
    const service = new AuthService(prisma as never, email as never);
    await service.register({
      ...registerInput,
      storeName: 'Principal',
    });
    const created = prisma.tenant.create.mock.calls[0][0].data as {
      stores: { create: { slug: string } };
    };
    expect(created.stores.create.slug).toBe('principal-1');
  });

  it('rejects duplicate email (email path unchanged)', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) => {
      if (where.email === 'maria@loja.test') return { id: 'existing' };
      return null;
    });
    const service = new AuthService(prisma as never, email as never);
    await expect(service.register(registerInput)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.register(registerInput)).rejects.toThrow(/email/i);
  });
});

describe('AuthService.login identifier', () => {
  const email = { sendVerifyEmail: jest.fn(), sendPasswordReset: jest.fn() };

  const verifiedUser = {
    id: 'u-owner',
    tenantId: 't1',
    email: 'maria@loja.test',
    ownerName: 'Maria',
    role: 'owner',
    ownerPhoneE164: '+5511987654321',
    passwordHash: hashPassword('secret123'),
    emailVerifiedAt: new Date(),
    tenant: { name: 'Loja da Maria', stores: [{ id: 's1', name: 'Loja da Maria' }] },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs in with email+password (unchanged)', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(verifiedUser);
    const service = new AuthService(prisma as never, email as never);
    const result = await service.login({
      email: 'maria@loja.test',
      password: 'secret123',
    });
    expect(result.user.email).toBe('maria@loja.test');
    expect(result.accessToken).toEqual(expect.any(String));
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'maria@loja.test' },
      }),
    );
  });

  it('logs in with national or E.164 owner phone + password', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) => {
      if (where.ownerPhoneE164 === '+5511987654321') return verifiedUser;
      return null;
    });
    const service = new AuthService(prisma as never, email as never);

    const byNational = await service.login({
      identifier: '11987654321',
      password: 'secret123',
    });
    expect(byNational.user.email).toBe('maria@loja.test');

    const byE164 = await service.login({
      identifier: '+5511987654321',
      password: 'secret123',
    });
    expect(byE164.user.id).toBe('u-owner');
  });
});

describe('AuthService.google', () => {
  const email = { sendVerifyEmail: jest.fn(), sendPasswordReset: jest.fn() };
  const googleClaims = {
    sub: 'google-sub-1',
    email: 'maria@gmail.com',
    name: 'Maria Silva',
    emailVerified: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAssertCnpj.mockResolvedValue(undefined);
    mockedVerifyGoogle.mockResolvedValue(googleClaims);
    mockedGoogleClientId.mockReturnValue(
      'test-google-client-id.apps.googleusercontent.com',
    );
    process.env.GOOGLE_CLIENT_ID =
      'test-google-client-id.apps.googleusercontent.com';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
  });

  it('finds existing owner by googleSub and returns a session (mocked verify)', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) => {
      if (where.googleSub === 'google-sub-1') {
        return {
          id: 'u-g',
          tenantId: 't1',
          email: 'maria@gmail.com',
          ownerName: 'Maria Silva',
          role: 'owner',
          emailVerifiedAt: new Date(),
          tenant: { name: 'Loja', stores: [{ id: 's1', name: 'Loja' }] },
        };
      }
      return null;
    });
    const service = new AuthService(prisma as never, email as never);
    const result = await service.googleLogin({ idToken: 'fake-google-id-token' });
    expect(mockedVerifyGoogle).toHaveBeenCalledWith('fake-google-id-token');
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.user.email).toBe('maria@gmail.com');
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it('requires CNPJ, phone and storeName on first Google signup', async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma as never, email as never);
    await expect(
      service.googleLogin({ idToken: 'fake-google-id-token' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it('creates owner on first Google signup with CNPJ+phone+storeName and unusable password hash', async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma as never, email as never);
    const result = await service.googleLogin({
      idToken: 'fake-google-id-token',
      storeName: 'Loja da Maria',
      cnpj: '11222333000181',
      ownerPhone: '11987654321',
    });

    expect(mockedAssertCnpj).toHaveBeenCalledWith('11222333000181');
    expect(result.user.email).toBe('maria@gmail.com');
    const created = prisma.tenant.create.mock.calls[0][0].data as {
      users: { create: Record<string, unknown> };
    };
    expect(created.users.create.googleSub).toBe('google-sub-1');
    expect(created.users.create.ownerPhoneE164).toBe('+5511987654321');
    expect(created.users.create.passwordHash).toEqual(expect.any(String));
    expect(created.users.create.emailVerifiedAt).toEqual(expect.any(Date));
    expect(email.sendVerifyEmail).not.toHaveBeenCalled();
  });

  it('rejects Google tokens whose email is not verified', async () => {
    mockedVerifyGoogle.mockResolvedValue({
      ...googleClaims,
      emailVerified: false,
    });
    const prisma = makePrisma();
    const service = new AuthService(prisma as never, email as never);
    await expect(
      service.googleLogin({ idToken: 'fake-google-id-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not auto-link an unverified email+password signup (no account squatting)', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockImplementation(
      async ({ where }: { where: Record<string, string> }) => {
        if (where.email === 'maria@gmail.com') {
          return {
            id: 'u-unverified',
            tenantId: 't-attacker',
            email: 'maria@gmail.com',
            ownerName: 'Attacker',
            role: 'owner',
            googleSub: null,
            emailVerifiedAt: null,
            tenant: { name: 'Fake', stores: [{ id: 's-x', name: 'Fake' }] },
          };
        }
        return null;
      },
    );
    const service = new AuthService(prisma as never, email as never);
    await expect(
      service.googleLogin({ idToken: 'fake-google-id-token' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it('links a verified owner by email and stores googleSub', async () => {
    const prisma = makePrisma();
    const verified = {
      id: 'u-owner',
      tenantId: 't1',
      email: 'maria@gmail.com',
      ownerName: 'Maria Silva',
      role: 'owner',
      googleSub: null,
      emailVerifiedAt: new Date(),
      tenant: { name: 'Loja', stores: [{ id: 's1', name: 'Loja' }] },
    };
    prisma.user.findUnique.mockImplementation(
      async ({ where }: { where: Record<string, string> }) => {
        if (where.email === 'maria@gmail.com') return verified;
        return null;
      },
    );
    prisma.user.update.mockResolvedValue({
      ...verified,
      googleSub: 'google-sub-1',
    });
    const service = new AuthService(prisma as never, email as never);
    const result = await service.googleLogin({ idToken: 'fake-google-id-token' });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-owner' },
        data: expect.objectContaining({ googleSub: 'google-sub-1' }),
      }),
    );
    expect(result.user.email).toBe('maria@gmail.com');
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it('does not attach Google login to a staff account with the same email', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockImplementation(
      async ({ where }: { where: Record<string, string> }) => {
        if (where.email === 'maria@gmail.com') {
          return {
            id: 'u-staff',
            tenantId: 't-staff',
            email: 'maria@gmail.com',
            ownerName: 'Equipe',
            role: 'staff',
            googleSub: null,
            emailVerifiedAt: new Date(),
            tenant: { name: 'Voltou', stores: [] },
          };
        }
        return null;
      },
    );
    const service = new AuthService(prisma as never, email as never);
    await expect(
      service.googleLogin({ idToken: 'fake-google-id-token' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects when the email is already linked to a different googleSub', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockImplementation(
      async ({ where }: { where: Record<string, string> }) => {
        if (where.email === 'maria@gmail.com') {
          return {
            id: 'u-other',
            tenantId: 't1',
            email: 'maria@gmail.com',
            ownerName: 'Maria',
            role: 'owner',
            googleSub: 'someone-else',
            emailVerifiedAt: new Date(),
            tenant: { name: 'Loja', stores: [{ id: 's1', name: 'Loja' }] },
          };
        }
        return null;
      },
    );
    const service = new AuthService(prisma as never, email as never);
    await expect(
      service.googleLogin({ idToken: 'fake-google-id-token' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('returns 503 when GOOGLE_CLIENT_ID is missing and does not invent a client id', async () => {
    mockedGoogleClientId.mockReturnValue(null);
    const prisma = makePrisma();
    const service = new AuthService(prisma as never, email as never);
    await expect(
      service.googleLogin({ idToken: 'fake-google-id-token' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service.googleLogin({ idToken: 'fake-google-id-token' }),
    ).rejects.toThrow(/GOOGLE_CLIENT_ID/);
    expect(mockedVerifyGoogle).not.toHaveBeenCalled();
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });
});

describe('signup isolation', () => {
  it('does not import staff CRM or Mercado Pago', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const service = fs.readFileSync(path.join(__dirname, 'auth.service.ts'), 'utf8');
    const controller = fs.readFileSync(
      path.join(__dirname, 'auth.controller.ts'),
      'utf8',
    );
    expect(service).not.toMatch(/mercadopago/i);
    expect(service).not.toMatch(/from ['"]\.\.\/staff/);
    expect(controller).not.toMatch(/mercadopago/i);
    expect(controller).not.toMatch(/from ['"]\.\.\/staff/);
  });
});

describe('AuthService.cnpjStatus', () => {
  const email = { sendVerifyEmail: jest.fn(), sendPasswordReset: jest.fn() };

  it('maps BrasilAPI outage to 503, not 400', async () => {
    mockedGetCnpjStatus.mockRejectedValue(
      new Error('Não foi possível validar o CNPJ agora. Tente novamente.'),
    );
    const service = new AuthService(makePrisma() as never, email as never);
    await expect(service.cnpjStatus('11222333000181')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
