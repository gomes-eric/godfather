import { serve } from '@hono/node-server';
import { ConfigError } from './config/loader.js';
import { ConfigStore } from './config/store.js';
import { createActionRunner } from './core/action.js';
import { AuditLog } from './core/audit.js';
import { openDatabase } from './db/client.js';
import { ManagedObjectStore } from './db/managed-objects.js';
import { resolveActor } from './discord/actor.js';
import { createDiscordAuditPublisher } from './discord/audit-publisher.js';
import { connectDiscord, createDiscordClient, isDiscordReady } from './discord/client.js';
import { commands } from './discord/commands/index.js';
import { createDirectory } from './discord/directory.js';
import { createDiscordGuildPort } from './discord/guild-port.js';
import { createConfirmationStore } from './discord/interactions/confirmation.js';
import { attachInteractionRouter } from './discord/interactions/router.js';
import { registerGuildCommands } from './discord/register-commands.js';
import { EnvError, loadEnv } from './env.js';
import { createHttpApp } from './http/app.js';
import { createLogger } from './logger.js';
import { SetupService } from './services/setup.service.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);

  const config = new ConfigStore(env.SERVER_CONFIG_PATH);
  logger.info({ path: env.SERVER_CONFIG_PATH }, 'server config loaded');

  const database = openDatabase(env.DATABASE_PATH);
  logger.info({ path: env.DATABASE_PATH }, 'database ready');

  const managed = new ManagedObjectStore(database.db);
  const audit = new AuditLog(database.db, logger);
  const runAction = createActionRunner(audit);
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
    const guild = await connectDiscord(client, {
      token: env.DISCORD_TOKEN,
      guildId: env.DISCORD_GUILD_ID,
      logger,
    });

    const directory = createDirectory(guild, managed, () => config.get());
    audit.setPublisher(
      createDiscordAuditPublisher(directory, () => config.get().settings.audit.channel, logger),
    );

    attachInteractionRouter(client, commands, {
      guild,
      logger,
      config,
      directory,
      audit,
      setup: new SetupService(createDiscordGuildPort(guild), managed, config),
      runAction,
      confirmations: createConfirmationStore(),
      resolveActor: (userId) => resolveActor(guild, directory, userId, 'slash'),
    });
    await registerGuildCommands({
      token: env.DISCORD_TOKEN,
      clientId: env.DISCORD_CLIENT_ID,
      guildId: guild.id,
      commands,
      logger,
    });
  } catch (error) {
    logger.fatal({ err: error }, 'could not start the Discord side of the bot');
    process.exitCode = 1;
    await stop('startup failure');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof EnvError || error instanceof ConfigError ? error.message : error);
  process.exitCode = 1;
});
