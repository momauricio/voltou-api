import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { verifyAccessToken } from './crypto.util';

type AuthedRequest = {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  user?: {
    sub: string;
    tenantId: string;
    email: string;
    role: string;
  };
};

function extractBearer(req: AuthedRequest): string | null {
  const raw = req.headers?.authorization ?? req.headers?.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = extractBearer(req);
    if (!token) {
      throw new UnauthorizedException('Token ausente.');
    }

    const payload = verifyAccessToken(token);
    if (!payload) {
      throw new UnauthorizedException('Token inválido ou expirado.');
    }

    req.user = payload;

    if (!req.query || typeof req.query !== 'object') {
      req.query = {};
    }
    if (
      'tenantId' in req.query &&
      req.query.tenantId != null &&
      req.query.tenantId !== '' &&
      String(req.query.tenantId) !== payload.tenantId
    ) {
      throw new ForbiddenException('tenantId não corresponde à sessão.');
    }
    req.query.tenantId = payload.tenantId;

    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      const body = req.body as Record<string, unknown>;
      if (
        'tenantId' in body &&
        body.tenantId != null &&
        body.tenantId !== '' &&
        String(body.tenantId) !== payload.tenantId
      ) {
        throw new ForbiddenException('tenantId não corresponde à sessão.');
      }
      if ('tenantId' in body || 'storeId' in body) {
        body.tenantId = payload.tenantId;
      }
    }

    return true;
  }
}
