import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type AccessTokenUser = {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenUser | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: AccessTokenUser }>();
    return req.user;
  },
);
