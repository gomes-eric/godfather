import { serve } from '@hono/node-server';
import { openDatabase } from './db/client.js';
import { connectDiscord, createDiscordClient, isDiscordReady } from './discord/client.js';
import { EnvError, loadEnv } from './env.js';
import { createHttpApp } from './http/app.js';
import { createLogger } from './logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);

  const database = openDatabase(env.DATABASE_PATH);
  logger.info({ path: env.DATABASE_PATH }, 'database ready');

  const client = createDiscordClient();

  const app = createHttpApp({
    discordReady: () => isDiscordReady(client),
    databaseHealthy: () => database.isHealthy(),
  });
  const server = serve({ fetch: app.fetch, port: env.HTTP_PORT }, (info) =>
    logger.info({ port: info.port, publicBaseUrl: env.PUBLIC_BASE_URL }, 'http server listening'),
  );

  // Closes every open handle so the process exits on its own. Calling process.exit()
  // while handles are still closing aborts on Windows (libuv assertion).
  let stopping: Promise<void> | undefined;
  const stop = (reason: string) =>
    (stopping ??= (async () => {
      logger.info({ reason }, 'shutting down');
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await client.destroy();
      database.close();
      logger.flush();
    })());

  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));

  try {
    await connectDiscord(client, {
      token: env.DISCORD_TOKEN,
      guildId: env.DISCORD_GUILD_ID,
      logger,
    });
  } catch (error) {
    logger.fatal({ err: error }, 'could not connect to Discord');
    process.exitCode = 1;
    await stop('startup failure');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof EnvError ? error.message : error);
  process.exitCode = 1;
});
