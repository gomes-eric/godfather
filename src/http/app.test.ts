import { describe, expect, it } from 'vitest';
import { createHttpApp } from './app.js';

function appWith(discord: boolean, database: boolean) {
  return createHttpApp({ discordReady: () => discord, databaseHealthy: () => database });
}

describe('GET /healthz', () => {
  it('returns 200 when Discord and the database are up', async () => {
    const res = await appWith(true, true).request('/healthz');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      checks: { discord: 'ok', database: 'ok' },
    });
  });

  it('returns 503 and names the failing check when Discord is down', async () => {
    const res = await appWith(false, true).request('/healthz');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'degraded',
      checks: { discord: 'down', database: 'ok' },
    });
  });

  it('returns 503 when the database is down', async () => {
    const res = await appWith(true, false).request('/healthz');

    expect(res.status).toBe(503);
  });

  it('returns 404 for unknown routes', async () => {
    expect((await appWith(true, true).request('/nope')).status).toBe(404);
  });
});
