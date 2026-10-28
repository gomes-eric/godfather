import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_AUDIENCE,
  generateSigningKey,
  loadSigningKey,
  publicJwk,
  signIdentityToken,
} from './wif-jwt.js';

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString()) as unknown;

describe('signIdentityToken', () => {
  const key = loadSigningKey(generateSigningKey());

  it('signs an ES256 JWT the public key verifies, with the kid of the registered JWK', () => {
    const now = new Date('2026-10-28T12:00:00Z');
    const token = signIdentityToken(
      key,
      { issuer: 'https://padrinho.example.ts.net', subject: 'padrinho:news' },
      now,
    );
    const [header, payload, signature] = token.split('.') as [string, string, string];

    expect(decode(header)).toEqual({ alg: 'ES256', typ: 'JWT', kid: publicJwk(key).kid });
    expect(decode(payload)).toMatchObject({
      iss: 'https://padrinho.example.ts.net',
      sub: 'padrinho:news',
      aud: CLAUDE_AUDIENCE,
      iat: 1_793_188_800,
      exp: 1_793_188_800 + 300,
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        {
          key: createPublicKey({ key: { ...publicJwk(key) }, format: 'jwk' }),
          dsaEncoding: 'ieee-p1363',
        },
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });

  it('gives every token its own jti, so each exchange is single-use', () => {
    const claims = { issuer: 'https://x', subject: 'padrinho:news' };
    const jti = (token: string) => (decode(token.split('.')[1]!) as { jti: string }).jti;
    expect(jti(signIdentityToken(key, claims))).not.toBe(jti(signIdentityToken(key, claims)));
  });
});

describe('publicJwk', () => {
  it('uses the RFC 7638 thumbprint as kid and never exposes the private part', () => {
    const jwk = publicJwk(loadSigningKey(generateSigningKey()));
    expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
    expect(jwk.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(jwk).not.toHaveProperty('d');
  });
});
