import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { ConfigError } from './config/loader.js';
import { ConfigStore } from './config/store.js';
import { createActionRunner } from './core/action.js';
import { AuditLog } from './core/audit.js';
import { ApplicationStore } from './db/applications.js';
import { CharacterStore } from './db/characters.js';
import { openDatabase } from './db/client.js';
import { EventStore } from './db/events.js';
import { ManagedObjectStore } from './db/managed-objects.js';
import { PartyStore } from './db/parties.js';
import { NewsStore } from './db/news.js';
import { TempVoiceStore } from './db/temp-voice.js';
import { createDiscordAnnouncements } from './discord/announcements.js';
import { createDiscordAuditPublisher } from './discord/audit-publisher.js';
import { connectDiscord, createDiscordClient } from './discord/client.js';
import { commands } from './discord/commands/index.js';
import { createDirectory } from './discord/directory.js';
import { createDiscordGuildPort } from './discord/guild-port.js';
import { createConfirmationStore } from './discord/interactions/confirmation.js';
import { attachInteractionRouter } from './discord/interactions/router.js';
import { attachMemberJoinListener } from './discord/listeners/member-join.js';
import { attachMessageListener } from './discord/listeners/message-create.js';
import { attachVoiceStateListener } from './discord/listeners/voice-state.js';
import { resolveActor } from './discord/members.js';
import { registerGuildCommands } from './discord/register-commands.js';
import { EnvError, loadEnv } from './env.js';
import { createHttpApp, type McpHandler } from './http/app.js';
import { createLogger } from './logger.js';
import { createMcpHandler } from './mcp/server.js';
import { ChannelService } from './services/channel.service.js';
import { EventService } from './services/event.service.js';
import { GameCharacterService } from './services/game-character.service.js';
import { LegionCheckService } from './services/legion-check.service.js';
import { MemberService } from './services/member.service.js';
import { MessageService } from './services/message.service.js';
import { ModerationService } from './services/moderation.service.js';
import { MusicGuardService } from './services/music-guard.service.js';
import { PartyService } from './services/party.service.js';
import { EventTimesService } from './services/event-times.service.js';
import { NewsService } from './services/news.service.js';
import { createNewsSummarizer } from './services/news-summarizer.js';
import { createClaudeClient } from './services/claude.js';
import { gameClassName } from './core/news-digest.js';
import { classRoles } from './config/schema.js';
import { RecruitmentDesk } from './services/recruitment-desk.service.js';
import { AllianceService } from './services/alliance.service.js';
import { RestrictionStore } from './db/restrictions.js';
import { RecruitmentService } from './services/recruitment.service.js';
import { RegistrationService } from './services/registration.service.js';
import { ReminderScheduler } from './services/reminder.scheduler.js';
import { RoleService } from './services/role.service.js';
import { SetupService } from './services/setup.service.js';
import { TokenService } from './services/token.service.js';
import { VoiceService } from './services/voice.service.js';
import { WelcomeService } from './services/welcome.service.js';

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
      discordReady: () => client.isReady(),
      databaseHealthy: () => database.isHealthy(),
    },
    () => mcpHandler,
  );
  const server = serve({ fetch: app.fetch, port: env.HTTP_PORT }, (info) =>
    logger.info({ port: info.port, publicBaseUrl: env.PUBLIC_BASE_URL }, 'http server listening'),
  );

  // Closes every open handle so the process exits on its own. Calling process.exit()
  // while handles are still closing aborts on Windows (libuv assertion).
  const stopJobs: (() => void)[] = [];
  let stopping: Promise<void> | undefined;
  const stop = (reason: string) =>
    (stopping ??= (async () => {
      logger.info({ reason }, 'shutting down');
      for (const stopJob of stopJobs) stopJob();
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
    voice
      .sweep()
      .then((swept) => logger.info(swept, 'temp voice rooms swept'))
      .catch((error: unknown) => logger.warn({ err: error }, 'temp voice sweep failed'));
    attachMessageListener(
      client,
      guild.id,
      new MusicGuardService({ directory, config, logger }),
      logger,
    );
    const welcome = new WelcomeService({ guild, directory, config, logger });
    attachMemberJoinListener(client, guild.id, welcome, logger);
    welcome
      .syncAutoRoles()
      .then((synced) => logger.info(synced, 'automatic roles synced'))
      .catch((error: unknown) => logger.warn({ err: error }, 'automatic role sync failed'));

    const eventStore = new EventStore(database.db);
    const scheduler = new ReminderScheduler({
      store: eventStore,
      managed,
      config: () => config.get(),
      port: createDiscordAnnouncements(guild, directory, () => config.get()),
      logger,
    });
    const eventTimes = new EventTimesService({
      config,
      runAction,
      botUserId: guild.client.user.id,
      logger,
      warn: async (text) => {
        await directory
          .channelByKey(config.get().settings.audit.channel)
          ?.send({ content: text, allowedMentions: { parse: [] } });
      },
      onChange: () => scheduler.refreshSoon(),
    });
    const characters = new GameCharacterService({ config, logger });
    const registrations = new CharacterStore(database.db);
    const restrictions = new RestrictionStore(database.db);
    const members = new MemberService({ guild, directory, config, restrictions, runAction });
    const late: { desk?: RecruitmentDesk } = {};
    const legion = new LegionCheckService({
      guild,
      config,
      directory,
      managed,
      registrations,
      characters,
      runAction,
      members,
      restrictions,
      review: async (input) => late.desk?.openReview(input),
      logger,
    });
    const claude = createClaudeClient(env, logger);
    logger.info({ enabled: claude !== null }, 'Claude API (workload identity federation)');
    const news = new NewsService({
      config,
      directory,
      store: new NewsStore(database.db),
      logger,
      ...(claude && {
        summarizer: createNewsSummarizer({
          client: claude,
          model: () => config.get().settings.news?.summary?.model ?? 'claude-sonnet-5-5',
          classes: () =>
            classRoles(config.get()).map((role) => ({
              key: role.key,
              name: role.name,
              gameName: gameClassName(role.key),
            })),
        }),
      }),
    });
    for (const job of [scheduler, eventTimes, news]) stopJobs.push(job.start());

    const setup = new SetupService(createDiscordGuildPort(guild), managed, config);
    const alliances = new AllianceService({
      guild,
      config,
      directory,
      setup,
      members,
      runAction,
      logger,
    });
    const registration = new RegistrationService({
      guild,
      config,
      directory,
      registrations,
      characters,
      members,
      legion,
      runAction,
      logger,
    });
    const applications = new ApplicationStore(database.db);
    const recruitmentDesk = new RecruitmentDesk({
      guild,
      config,
      directory,
      recruitment: new RecruitmentService({ store: applications, runAction }),
      applications,
      registration,
      members,
      alliances,
      logger,
    });
    late.desk = recruitmentDesk;
    stopJobs.push(recruitmentDesk.start(), legion.start());
    const services = {
      guild,
      config,
      directory,
      audit,
      runAction,
      setup,
      members,
      alliances,
      moderation: new ModerationService({ guild, directory, runAction }),
      messages: new MessageService({ guild, runAction }),
      events: new EventService({ store: eventStore, scheduler, config, runAction }),
      channels: new ChannelService({ guild, managed, runAction }),
      roles: new RoleService({ guild, directory, runAction }),
      characters,
      registrations,
      registration,
      applications,
      recruitmentDesk,
      legion,
      news,
    };

    attachInteractionRouter(client, commands, {
      ...services,
      logger,
      voice,
      parties: new PartyService({
        guild,
        directory,
        store: new PartyStore(database.db),
        runAction,
      }),
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
