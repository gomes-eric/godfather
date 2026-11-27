import { existsSync, readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { oidcFederationProvider } from '@anthropic-ai/sdk/lib/credentials/oidc-federation';
import { loadSigningKey, signIdentityToken, WIF_SUBJECT, wifKeyPath } from '../core/wif-jwt.js';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';

export function createClaudeClient(env: Env, logger: Logger): Anthropic | null {
  const ruleId = env.ANTHROPIC_FEDERATION_RULE_ID;
  const organizationId = env.ANTHROPIC_ORGANIZATION_ID;
  const serviceAccountId = env.ANTHROPIC_SERVICE_ACCOUNT_ID;
  if (!ruleId || !organizationId || !serviceAccountId) return null;

  const keyPath = wifKeyPath(env.DATABASE_PATH);
  if (!existsSync(keyPath)) {
    logger.warn({ keyPath }, 'Claude federation ids set but no signing key; run wif-keygen');
    return null;
  }
  const key = loadSigningKey(readFileSync(keyPath, 'utf8'));
  const baseURL = 'https://api.anthropic.com';

  return new Anthropic({
    baseURL,
    credentials: oidcFederationProvider({
      identityTokenProvider: () =>
        signIdentityToken(key, { issuer: env.PUBLIC_BASE_URL, subject: WIF_SUBJECT }),
      federationRuleId: ruleId,
      organizationId,
      serviceAccountId,
      workspaceId: env.ANTHROPIC_WORKSPACE_ID,
      baseURL,
      fetch,
    }),
  });
}
