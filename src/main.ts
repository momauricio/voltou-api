import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { assertAuthSecret } from './auth/auth-secret';

try {
  assertAuthSecret();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
