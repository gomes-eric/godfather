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
import { createDiscordNewsPort } from './discord/news.js';
import { createDiscordGuildAdmin } from './discord/guild-admin-port.js';
import { createDiscordGuildPort } from './discord/guild-port.js';
import { createConfirmationStore } from './discord/interactions/confirmation.js';
import { attachInteractionRouter } from './discord/interactions/router.js';
import { attachMemberJoinListener } from './discord/listeners/member-join.js';
import { attachMessageListener } from './discord/listeners/message-create.js';
import { attachVoiceStateListener } from './discord/listeners/voice-state.js';
import { resolveActor } from './discord/members.js';
import { registerGuildCommands } from './discord/register-commands.js';
import { createDiscordVoicePort } from './discord/voice-port.js';
import { EnvError, loadEnv } from './env.js';
import { createHttpApp, type McpHandler } from './http/app.js';
import { createLogger } from './logger.js';
import { createMcpHandler } from './mcp/server.js';
import { ChannelService } from './services/channel.service.js';
import { CharacterLookup } from './services/character-lookup.service.js';
import { EventCalendar } from './services/event-calendar.js';
import { GameCharacterService } from './services/game-character.service.js';
import { LegionCheckService } from './services/legion-check.service.js';
import { RankingBoard } from './services/ranking-board.service.js';
import { Roster } from './services/roster.service.js';
import { createDiscordMemberPort } from './discord/member-port.js';
import { createDiscordRecruitmentBoard } from './discord/recruitment-board.js';
import { MessageService } from './services/message.service.js';
import { ModerationService } from './services/moderation.service.js';
import { MusicGuardService } from './services/music-guard.service.js';
import { PartyService } from './services/party.service.js';
import { EventTimesService } from './services/event-times.service.js';
import { NewsService } from './services/news.service.js';
import { createNewsSummarizer } from './services/news-summarizer.js';
import { createClaudeClient } from './services/claude.js';
import { AllianceService } from './services/alliance.service.js';
import { RestrictionStore } from './db/restrictions.js';
import { Recruitment } from './services/recruitment.service.js';
import { RegistrationService } from './services/registration.service.js';
import { RoleService } from './services/role.service.js';
import { SetupService } from './services/setup.service.js';
import { TokenService } from './services/token.service.js';
import { VoiceService } from './services/voice.service.js';
import { WelcomeService } from './services/welcome.service.js';
import { auditChannelKey } from './config/views.js';

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
      createDiscordAuditPublisher(directory, () => auditChannelKey(config.get()), logger),
    );

    const voice = new VoiceService({
      port: createDiscordVoicePort(guild, logger),
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

    const calendar = new EventCalendar({
      store: new EventStore(database.db),
      managed,
      config,
      runAction,
      port: createDiscordAnnouncements(directory, () => config.get()),
      classesOf: (userId) => {
        const member = guild.members.cache.get(userId);
        return member ? directory.classesOf(member).map((role) => role.name) : [];
      },
      logger,
    });
    const eventTimes = new EventTimesService({
      config,
      calendar,
      botUserId: guild.client.user.id,
      logger,
      warn: async (text) => {
        await directory
          .channelByKey(auditChannelKey(config.get()))
          ?.send({ content: text, allowedMentions: { parse: [] } });
      },
    });
    const characters = new GameCharacterService({ config, logger });
    const registrations = new CharacterStore(database.db);
    const restrictions = new RestrictionStore(database.db);
    const members = new Roster({
      members: createDiscordMemberPort(guild),
      directory,
      config,
      restrictions,
      runAction,
    });
    const ranking = new RankingBoard({ guild, config, directory, managed, registrations });
    const claude = createClaudeClient(env, logger);
    logger.info({ enabled: claude !== null }, 'Claude API (workload identity federation)');
    const news = new NewsService({
      config,
      port: createDiscordNewsPort(directory),
      store: new NewsStore(database.db),
      logger,
      ...(claude && { summarizer: createNewsSummarizer(claude) }),
    });
    for (const job of [calendar, eventTimes, news]) stopJobs.push(job.start());

    const setup = new SetupService(createDiscordGuildPort(guild), managed, config);
    const alliances = new AllianceService({
      guild,
      config,
      directory,
      setup,
      roster: members,
      runAction,
      logger,
    });
    const registration = new RegistrationService({
      config,
      directory,
      registrations,
      characters,
      roster: members,
      ranking,
      runAction,
      logger,
    });
    const applications = new ApplicationStore(database.db);
    const botUserId = guild.client.user.id;
    const recruitmentDesk = new Recruitment({
      store: applications,
      board: createDiscordRecruitmentBoard({ guild, config, directory, logger }),
      roster: members,
      registration,
      alliances,
      config,
      directory,
      runAction,
      botUserId,
      logger,
    });
    const legion = new LegionCheckService({
      config,
      directory,
      ranking,
      registrations,
      characters,
      roster: members,
      restrictions,
      review: (request) => recruitmentDesk.openReview(request),
      botUserId,
      runAction,
      logger,
    });
    stopJobs.push(recruitmentDesk.start(), legion.start());
    const admin = createDiscordGuildAdmin(guild);
    const services = {
      guild,
      config,
      directory,
      audit,
      runAction,
      setup,
      roster: members,
      alliances,
      moderation: new ModerationService({ guild: admin, directory, runAction }),
      messages: new MessageService({ guild: admin, runAction }),
      events: calendar,
      channels: new ChannelService({ guild: admin, managed, runAction }),
      roles: new RoleService({ guild: admin, directory, runAction }),
      characters: new CharacterLookup({
        characters,
        registrations,
        config,
        memberName: (userId) => guild.members.cache.get(userId)?.displayName,
        runAction,
      }),
      registration,
      recruitment: recruitmentDesk,
      legion,
      ranking,
      news,
    };

    attachInteractionRouter(client, commands, {
      ...services,
      logger,
      voice,
      parties: new PartyService({
        store: new PartyStore(database.db),
        runAction,
        classEmoji: (userId) => {
          const member = guild.members.cache.get(userId);
          return member && directory.classesOf(member)[0]?.emoji;
        },
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
