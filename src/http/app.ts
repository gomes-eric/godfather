import { Hono } from 'hono';

export interface HealthProbes {
  discordReady(): boolean;
  databaseHealthy(): boolean;
}

export type McpHandler = (request: Request) => Promise<Response>;

/**
 * HTTP surface of the bot: `/healthz` and the MCP endpoint `/mcp`. The MCP handler needs the
 * Discord guild, so it's read lazily and the endpoint answers 503 until the bot is connected.
 */
export function createHttpApp(
  probes: HealthProbes,
  mcp: () => McpHandler | undefined = () => undefined,
): Hono {
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

  app.all('/mcp', async (c) => {
    const handler = mcp();
    if (!handler) return c.json({ error: 'Padrinho is still connecting to Discord.' }, 503);
    return handler(c.req.raw);
  });

  return app;
}
