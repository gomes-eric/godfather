// Padrinho as its own identity provider for Workload Identity Federation: an ES256 key pair kept
// on the server signs short-lived JWTs that the Claude API exchanges for access tokens. The public
// key is registered in the Claude Console as an issuer with an inline JWKS.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
} from 'node:crypto';

export const CLAUDE_AUDIENCE = 'https://api.anthropic.com';
/** Identity tokens live 5 minutes; each exchange gets a fresh one (unique `jti`). */
const LIFETIME_SECONDS = 300;

export interface PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  kid: string;
  alg: 'ES256';
  use: 'sig';
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/** The public half as a JWK, with the RFC 7638 thumbprint as its `kid`. */
export function publicJwk(privateKey: KeyObject): PublicJwk {
  const { kty, crv, x, y } = createPublicKey(privateKey).export({ format: 'jwk' });
  if (kty !== 'EC' || crv !== 'P-256' || !x || !y) throw new Error('expected a P-256 EC key');
  // Thumbprint input: the required members, in lexicographic order, without whitespace.
  const kid = base64url(createHash('sha256').update(JSON.stringify({ crv, kty, x, y })).digest());
  return { kty, crv, x, y, kid, alg: 'ES256', use: 'sig' };
}

/** A new P-256 key, as PKCS#8 PEM for the key file. */
export function generateSigningKey(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
}

export function loadSigningKey(pem: string): KeyObject {
  return createPrivateKey(pem);
}

/** A signed identity token for one token exchange. */
export function signIdentityToken(
  privateKey: KeyObject,
  claims: { issuer: string; subject: string },
  now: Date = new Date(),
): string {
  const { kid } = publicJwk(privateKey);
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
  const payload = base64url(
    JSON.stringify({
      iss: claims.issuer,
      sub: claims.subject,
      aud: CLAUDE_AUDIENCE,
      iat,
      exp: iat + LIFETIME_SECONDS,
      jti: randomUUID(),
    }),
  );
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${payload}.${base64url(signature)}`;
}
