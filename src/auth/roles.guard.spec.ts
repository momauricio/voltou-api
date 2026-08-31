import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { USER_ROLES } from './roles';

function contextOf(req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function guard(required?: string[]) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows any authenticated user when the route has no role requirement', () => {
    expect(
      guard().canActivate(contextOf({ user: { role: USER_ROLES.OWNER } })),
    ).toBe(true);
  });

  it('allows staff on staff-only routes', () => {
    expect(
      guard([USER_ROLES.STAFF]).canActivate(
        contextOf({ user: { role: USER_ROLES.STAFF } }),
      ),
    ).toBe(true);
  });

  it('forbids owner JWT on staff-only mutations', () => {
    expect(() =>
      guard([USER_ROLES.STAFF]).canActivate(
        contextOf({ user: { role: USER_ROLES.OWNER } }),
      ),
    ).toThrow(ForbiddenException);
  });
});
