import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessTokenGuard } from './access-token.guard';
import { signAccessToken } from './crypto.util';

function contextOf(req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function guard(isPublic = false) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
  return new AccessTokenGuard(reflector);
}

function token(role: string, tenantId = 'tenant-owner') {
  return signAccessToken({
    sub: `user-${role}`,
    tenantId,
    email: `${role}@voltou.test`,
    role,
  });
}

describe('AccessTokenGuard', () => {
  it('rejects missing bearer token', () => {
    expect(() =>
      guard().canActivate(contextOf({ headers: {}, query: {}, body: {} })),
    ).toThrow(UnauthorizedException);
  });

  it('binds owner requests to the JWT tenantId', () => {
    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token('owner', 'tenant-a')}` },
      query: { tenantId: 'tenant-a' },
      body: { tenantId: 'tenant-a', storeId: 'store-1' },
    };
    expect(guard().canActivate(contextOf(req))).toBe(true);
    expect((req.query as { tenantId: string }).tenantId).toBe('tenant-a');
    expect((req.body as { tenantId: string }).tenantId).toBe('tenant-a');
    expect((req.user as { role: string }).role).toBe('owner');
  });

  it('rejects owner JWT that tries another tenantId', () => {
    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token('owner', 'tenant-a')}` },
      query: { tenantId: 'tenant-b' },
      body: {},
    };
    expect(() => guard().canActivate(contextOf(req))).toThrow(
      ForbiddenException,
    );
  });

  it('lets staff keep a cross-tenant tenantId on query and body', () => {
    const req: Record<string, unknown> = {
      headers: {
        authorization: `Bearer ${token('staff', 'tenant-staff-home')}`,
      },
      query: { tenantId: 'tenant-loja-x' },
      body: { tenantId: 'tenant-loja-x', storeId: 'store-x' },
    };

    expect(guard().canActivate(contextOf(req))).toBe(true);
    expect((req.query as { tenantId: string }).tenantId).toBe('tenant-loja-x');
    expect((req.body as { tenantId: string }).tenantId).toBe('tenant-loja-x');
    expect((req.user as { role: string }).role).toBe('staff');
  });
});
