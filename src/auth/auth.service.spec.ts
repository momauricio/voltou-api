import { AuthService } from './auth.service';
import { hashPassword, signAccessToken, verifyAccessToken } from './crypto.util';

describe('AuthService role claim', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
  };
  const email = { sendVerifyEmail: jest.fn(), sendPasswordReset: jest.fn() };
  const service = new AuthService(prisma as never, email as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('puts role on the JWT and login payload so staff session stays distinct', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-staff',
      tenantId: 't-staff',
      email: 'staff@voltou.test',
      ownerName: 'Equipe Voltou',
      role: 'staff',
      passwordHash: hashPassword('secret-password'),
      emailVerifiedAt: new Date(),
      tenant: { name: 'Voltou', stores: [] },
    });

    const result = await service.login({
      email: 'staff@voltou.test',
      password: 'secret-password',
    });

    expect(result.user.role).toBe('staff');
    expect(result.user.storeId).toBeNull();
    const payload = verifyAccessToken(result.accessToken);
    expect(payload?.role).toBe('staff');
  });

  it('returns role on /me', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-owner',
      tenantId: 't1',
      email: 'owner@loja.test',
      ownerName: 'Dona Loja',
      role: 'owner',
      tenant: { name: 'Loja', stores: [{ id: 's1', name: 'Loja' }] },
    });

    const token = signAccessToken({
      sub: 'u-owner',
      tenantId: 't1',
      email: 'owner@loja.test',
      role: 'owner',
    });

    const result = await service.me(token);
    expect(result.user.role).toBe('owner');
    expect(result.user.storeId).toBe('s1');
  });
});
