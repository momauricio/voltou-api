import { readFileSync } from 'fs';

// WAHA webhook HMAC secret may be provisioned as a file in the container.
// Read before dotenv (like prod), so the file value wins over .env.
try {
  const hmac = readFileSync('/app/.whatsapp-hook-hmac-key', 'utf8').trim();
  if (hmac) process.env.WHATSAPP_HOOK_HMAC_KEY = hmac;
} catch {
  /* optional file */
}

import 'dotenv/config';
import { assertAuthSecret, AUTH_SECRET_UNSAFE_MESSAGE } from './auth/auth-secret';

try {
  assertAuthSecret();
} catch (err) {
  console.error(err instanceof Error ? err.message : AUTH_SECRET_UNSAFE_MESSAGE);
  process.exit(1);
}

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  // One hop (nginx / Hostinger / load balancer). Required so per-IP
  // throttles use X-Forwarded-For instead of the proxy's address.
  app.set('trust proxy', 1);

  const corsOrigins = (
    process.env.CORS_ORIGINS ??
    'http://localhost:3000,http://127.0.0.1:3000,https://voltou-web.vercel.app'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
