import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

export type GoogleIdTokenClaims = {
  sub: string;
  email: string;
  name?: string;
  emailVerified: boolean;
};

export function getGoogleClientId(): string | null {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  return id ? id : null;
}

/**
 * Verifies a Google ID token against GOOGLE_CLIENT_ID.
 * Does not invent a client id — missing env is 503.
 */
export async function verifyGoogleIdToken(
  idToken: string,
): Promise<GoogleIdTokenClaims> {
  const audience = getGoogleClientId();
  if (!audience) {
    throw new ServiceUnavailableException(
      'Google login não configurado — defina GOOGLE_CLIENT_ID com o Client ID OAuth do Google (não invente um valor).',
    );
  }

  const token = idToken?.trim();
  if (!token) {
    throw new UnauthorizedException('Token Google inválido.');
  }

  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new UnauthorizedException('Token Google inválido.');
  }

  if (!res.ok) {
    throw new UnauthorizedException('Token Google inválido.');
  }

  const data = (await res.json()) as {
    aud?: string;
    sub?: string;
    email?: string;
    email_verified?: string | boolean;
    name?: string;
  };

  if (data.aud !== audience || !data.sub || !data.email) {
    throw new UnauthorizedException('Token Google inválido.');
  }

  const emailVerified =
    data.email_verified === true || data.email_verified === 'true';

  return {
    sub: data.sub,
    email: data.email.trim().toLowerCase(),
    name: data.name,
    emailVerified,
  };
}
