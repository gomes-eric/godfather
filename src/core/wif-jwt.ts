import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
} from 'node:crypto';
import { dirname, join } from 'node:path';

export const CLAUDE_AUDIENCE = 'https://api.anthropic.com';
const LIFETIME_SECONDS = 300;

/** The `sub` of Padrinho's identity tokens; the federation rule matches it exactly. */
export const WIF_SUBJECT = 'padrinho:news';

export function wifKeyPath(databasePath: string): string {
  return join(dirname(databasePath), 'wif', 'issuer-es256.pem');
}

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

export function generateSigningKey(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
}

export function loadSigningKey(pem: string): KeyObject {
  return createPrivateKey(pem);
}

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
