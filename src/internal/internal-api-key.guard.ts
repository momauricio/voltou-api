import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

function extractApiKey(headers: Record<string, string | string[] | undefined>) {
  const raw =
    headers['x-api-key'] ??
    headers['X-Api-Key'] ??
    headers['x-api-key'.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim() : '';
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.INTERNAL_API_KEY?.trim();
    if (!expected) {
      throw new UnauthorizedException(
        'INTERNAL_API_KEY não configurada no servidor.',
      );
    }

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const provided = extractApiKey(req.headers);
    if (!provided || !safeEqual(provided, expected)) {
      throw new UnauthorizedException('API key inválida.');
    }
    return true;
  }
}
