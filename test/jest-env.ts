import { randomBytes } from 'crypto';

if (!process.env.AUTH_SECRET) {
  process.env.AUTH_SECRET = randomBytes(32).toString('hex');
}
