import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { getGoogleClientId, verifyGoogleIdToken } from './google-id-token';

describe('verifyGoogleIdToken', () => {
  const originalFetch = global.fetch;
  const originalClientId = process.env.GOOGLE_CLIENT_ID;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
    }
  });

  it('returns 503 with a clear message when GOOGLE_CLIENT_ID is missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    await expect(verifyGoogleIdToken('any-token-value')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(verifyGoogleIdToken('any-token-value')).rejects.toThrow(
      /GOOGLE_CLIENT_ID/,
    );
    expect(getGoogleClientId()).toBeNull();
  });

  it('verifies audience against env client id (mocked tokeninfo)', async () => {
    process.env.GOOGLE_CLIENT_ID = 'real-client.apps.googleusercontent.com';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        aud: 'real-client.apps.googleusercontent.com',
        iss: 'https://accounts.google.com',
        sub: 'sub-1',
        email: 'maria@gmail.com',
        email_verified: 'true',
        name: 'Maria',
      }),
    }) as unknown as typeof fetch;

    const claims = await verifyGoogleIdToken('header.payload.sig');
    expect(claims).toEqual({
      sub: 'sub-1',
      email: 'maria@gmail.com',
      name: 'Maria',
      emailVerified: true,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/tokeninfo',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects token when audience does not match GOOGLE_CLIENT_ID', async () => {
    process.env.GOOGLE_CLIENT_ID = 'real-client.apps.googleusercontent.com';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        aud: 'someone-else.apps.googleusercontent.com',
        iss: 'https://accounts.google.com',
        sub: 'sub-1',
        email: 'maria@gmail.com',
        email_verified: 'true',
      }),
    }) as unknown as typeof fetch;

    await expect(
      verifyGoogleIdToken('header.payload.sig'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects unverified Google email', async () => {
    process.env.GOOGLE_CLIENT_ID = 'real-client.apps.googleusercontent.com';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        aud: 'real-client.apps.googleusercontent.com',
        iss: 'https://accounts.google.com',
        sub: 'sub-1',
        email: 'maria@gmail.com',
        email_verified: 'false',
      }),
    }) as unknown as typeof fetch;

    await expect(verifyGoogleIdToken('header.payload.sig')).rejects.toThrow(
      /não verificado/i,
    );
  });
});
