import { Hono } from 'hono';

export interface HealthProbes {
  discordReady(): boolean;
  databaseHealthy(): boolean;
}

/** HTTP surface of the bot. Phase 7 mounts the MCP endpoint (`/mcp`) here. */
export function createHttpApp(probes: HealthProbes): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => {
    const discord = probes.discordReady();
    const database = probes.databaseHealthy();
    const ok = discord && database;

    return c.json(
      {
        status: ok ? 'ok' : 'degraded',
        checks: { discord: discord ? 'ok' : 'down', database: database ? 'ok' : 'down' },
      },
      ok ? 200 : 503,
    );
  });

  return app;
}
