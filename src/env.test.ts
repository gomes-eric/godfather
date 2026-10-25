import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from './env.js';

const validEnv = {
  DISCORD_TOKEN: 'token',
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_GUILD_ID: '876543210987654321',
  PUBLIC_BASE_URL: 'https://padrinho.example.ts.net',
};

describe('loadEnv', () => {
  it('applies defaults for optional variables', () => {
    const env = loadEnv(validEnv);

    expect(env.HTTP_PORT).toBe(8080);
    expect(env.DATABASE_PATH).toBe('./data/padrinho.db');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.NODE_ENV).toBe('development');
  });

  it('coerces HTTP_PORT from a string', () => {
    expect(loadEnv({ ...validEnv, HTTP_PORT: '9090' }).HTTP_PORT).toBe(9090);
  });

  it('lists every invalid variable in the error', () => {
    const run = () =>
      loadEnv({ ...validEnv, DISCORD_TOKEN: undefined, DISCORD_GUILD_ID: 'not-an-id' });

    expect(run).toThrow(EnvError);
    expect(run).toThrow(/DISCORD_TOKEN/);
    expect(run).toThrow(/DISCORD_GUILD_ID: must be a Discord snowflake id/);
  });

  it('rejects a PUBLIC_BASE_URL that is not a URL', () => {
    expect(() => loadEnv({ ...validEnv, PUBLIC_BASE_URL: 'padrinho' })).toThrow(/PUBLIC_BASE_URL/);
  });
});
