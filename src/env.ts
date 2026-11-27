import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord snowflake id');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: snowflake,
  DISCORD_GUILD_ID: snowflake,
  PUBLIC_BASE_URL: z.url(),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_PATH: z.string().min(1).default('./data/padrinho.db'),
  SERVER_CONFIG_PATH: z.string().min(1).default('./server.yaml'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Request the privileged Message Content intent (enable it in the Developer Portal first). */
  DISCORD_MESSAGE_CONTENT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Never set ANTHROPIC_API_KEY: it would take precedence over federation.
  ANTHROPIC_FEDERATION_RULE_ID: z.string().startsWith('fdrl_').optional(),
  ANTHROPIC_ORGANIZATION_ID: z.uuid().optional(),
  ANTHROPIC_SERVICE_ACCOUNT_ID: z.string().startsWith('svac_').optional(),
  ANTHROPIC_WORKSPACE_ID: z.string().startsWith('wrkspc_').optional(),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  override name = 'EnvError';
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new EnvError(`Invalid environment variables:\n${details}`);
  }
  return result.data;
}
