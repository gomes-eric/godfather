import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { ConfigError } from './config/loader.js';
import { ConfigStore } from './config/store.js';
import { createActionRunner } from './core/action.js';
import { AuditLog } from './core/audit.js';
import { openDatabase } from './db/client.js';
import { EventStore } from './db/events.js';
import { FieldBossStore } from './db/field-bosses.js';
import { ManagedObjectStore } from './db/managed-objects.js';
import { TempVoiceStore } from './db/temp-voice.js';
import { resolveActor } from './discord/actor.js';
import { createDiscordAnnouncements } from './discord/announcements.js';
import { createDiscordAuditPublisher } from './discord/audit-publisher.js';
import { connectDiscord, createDiscordClient, isDiscordReady } from './discord/client.js';
import { commands } from './discord/commands/index.js';
import { createDirectory } from './discord/directory.js';
import { createDiscordGuildPort } from './discord/guild-port.js';
import { attachMemberJoinListener } from './discord/listeners/member-join.js';
import { attachMessageListener } from './discord/listeners/message-create.js';
import { attachVoiceStateListener } from './discord/listeners/voice-state.js';
import { createConfirmationStore } from './discord/interactions/confirmation.js';
import { attachInteractionRouter } from './discord/interactions/router.js';
import { registerGuildCommands } from './discord/register-commands.js';
import { EnvError, loadEnv } from './env.js';
import { createHttpApp, type McpHandler } from './http/app.js';
import { createLogger } from './logger.js';
import { createMcpHandler } from './mcp/server.js';
import { ChannelService } from './services/channel.service.js';
import { EventService } from './services/event.service.js';
import { FieldBossService } from './services/field-boss.service.js';
import { MemberService } from './services/member.service.js';
import { MessageService } from './services/message.service.js';
import { ModerationService } from './services/moderation.service.js';
import { MusicGuardService } from './services/music-guard.service.js';
import { ReminderScheduler } from './services/reminder.scheduler.js';
import { RoleService } from './services/role.service.js';
import { SetupService } from './services/setup.service.js';
import { TokenService } from './services/token.service.js';
import { VoiceService } from './services/voice.service.js';
import { WelcomeService } from './services/welcome.service.js';
import { PatchNotesService } from './services/patch-notes.service.js';
import { PatchNoteStore } from './db/patch-notes.js';
import { GameCharacterService } from './services/game-character.service.js';
import { CharacterStore } from './db/characters.js';
import { LegionCheckService } from './services/legion-check.service.js';
import { PartyService } from './services/party.service.js';
import { PartyStore } from './db/parties.js';

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
  const client = createDiscordClient({ messageContent: env.DISCORD_MESSAGE_CONTENT });
  const tokens = new TokenService(database.db, runAction);
  const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };

  let mcpHandler: McpHandler | undefined;
  const app = createHttpApp(
    {
      discordReady: () => isDiscordReady(client),
      databaseHealthy: () => database.isHealthy(),
    },
    () => mcpHandler,
  );
  const server = serve({ fetch: app.fetch, port: env.HTTP_PORT }, (info) =>
    logger.info({ port: info.port, publicBaseUrl: env.PUBLIC_BASE_URL }, 'http server listening'),
  );

  // Closes every open handle so the process exits on its own. Calling process.exit()
  // while handles are still closing aborts on Windows (libuv assertion).
  let stopScheduler: () => void = () => undefined;
  let stopping: Promise<void> | undefined;
  const stop = (reason: string) =>
    (stopping ??= (async () => {
      logger.info({ reason }, 'shutting down');
      stopScheduler();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await client.destroy();
      database.close();
      logger.flush();
    })());

  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));
  server.once('error', (error) => {
    logger.fatal({ err: error, port: env.HTTP_PORT }, 'http server failed (is the port in use?)');
    process.exitCode = 1;
    void stop('http server error');
  });

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

    const voice = new VoiceService({
      guild,
      config,
      managed,
      rooms: new TempVoiceStore(database.db),
      runAction,
      logger,
    });
    attachVoiceStateListener(client, guild.id, voice, logger);
    attachMessageListener(
      client,
      guild.id,
      new MusicGuardService({ directory, config, logger }),
      logger,
    );
    voice
      .sweep()
      .then((swept) => logger.info(swept, 'temp voice rooms swept'))
      .catch((error: unknown) => logger.warn({ err: error }, 'temp voice sweep failed'));

    const eventStore = new EventStore(database.db);
    const bosses = new FieldBossService({
      store: new FieldBossStore(database.db),
      config,
      runAction,
      logger,
      warn: async (text) => {
        await directory
          .channelByKey(config.get().settings.audit.channel)
          ?.send({ content: text, allowedMentions: { parse: [] } });
      },
      onChange: () => void scheduler.tick().catch(() => undefined),
    });
    const scheduler = new ReminderScheduler({
      store: eventStore,
      managed,
      config: () => config.get(),
      port: createDiscordAnnouncements(guild, directory, () => config.get()),
      logger,
      sources: [bosses],
    });
    const patchNotes = new PatchNotesService({
      config,
      directory,
      store: new PatchNoteStore(database.db),
      logger,
    });
    stopScheduler = () => {
      scheduler.stop();
      bosses.stop();
      patchNotes.stop();
    };
    scheduler.start();
    bosses.start();
    patchNotes.start();

    // Shared by slash commands and MCP tools: both adapters call the same services.
    const services = {
      guild,
      config,
      directory,
      audit,
      runAction,
      setup: new SetupService(createDiscordGuildPort(guild), managed, config),
      members: new MemberService({ guild, directory, config, runAction }),
      moderation: new ModerationService({ guild, directory, runAction }),
      messages: new MessageService({ guild, runAction }),
      events: new EventService({ store: eventStore, scheduler, config, runAction }),
      bosses,
      channels: new ChannelService({ guild, managed, runAction }),
      roles: new RoleService({ guild, directory, config, runAction }),
    };

    const characters = new GameCharacterService({ config, logger });
    const registrations = new CharacterStore(database.db);
    const legion = new LegionCheckService({
      guild,
      config,
      directory,
      managed,
      registrations,
      characters,
      members: services.members,
      runAction,
      logger,
    });
    legion.start();
    const stopLegion = stopScheduler;
    stopScheduler = () => {
      stopLegion?.();
      legion.stop();
    };

    attachInteractionRouter(client, commands, {
      ...services,
      characters,
      registrations,
      legion,
      parties: new PartyService({
        guild,
        config,
        directory,
        store: new PartyStore(database.db),
        runAction,
      }),
      logger,
      voice,
      tokens,
      mcpUrl: new URL('/mcp', env.PUBLIC_BASE_URL).toString(),
      confirmations: createConfirmationStore(),
      resolveActor: (userId) => resolveActor(guild, directory, userId, 'slash'),
    });

    mcpHandler = createMcpHandler({
      tokens,
      resolveActor: (userId, harness) => resolveActor(guild, directory, userId, 'mcp', harness),
      services: { ...services, messageContent: env.DISCORD_MESSAGE_CONTENT },
      logger,
      version,
    });
    const welcome = new WelcomeService({ guild, directory, config, logger });
    attachMemberJoinListener(client, guild.id, welcome, logger);
    welcome
      .syncAutoRoles()
      .then((synced) => logger.info(synced, 'automatic roles synced'))
      .catch((error: unknown) => logger.warn({ err: error }, 'automatic role sync failed'));

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
