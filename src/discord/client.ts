import { Client, Events, GatewayIntentBits, Options, type Guild } from 'discord.js';
import type { Logger } from '../logger.js';

// GuildMembers is a privileged intent: enable "Server Members Intent" in the Developer Portal.
// MessageContent is optional (DISCORD_MESSAGE_CONTENT): only the MCP `read_messages` tool needs it.
const baseIntents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages,
];

export function createDiscordClient(options: { messageContent?: boolean } = {}): Client {
  return new Client({
    intents: options.messageContent
      ? [...baseIntents, GatewayIntentBits.MessageContent]
      : baseIntents,
    // Nothing reads old messages from the cache; the bot's own cards (panels, agenda, reminders)
    // sit in quiet channels and stay within the last 20. Bans are always fetched fresh.
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 20,
      GuildBanManager: 0,
    }),
  });
}

/** Logs in and resolves once the client is ready and the configured guild is reachable. */
export async function connectDiscord(
  client: Client,
  options: { token: string; guildId: string; logger: Logger },
): Promise<Guild> {
  const { token, guildId, logger } = options;

  client.on(Events.Warn, (message) => logger.warn({ discord: message }, 'discord warning'));
  client.on(Events.Error, (error) => logger.error({ err: error }, 'discord client error'));
  client.on(Events.ShardDisconnect, (_event, shardId) =>
    logger.warn({ shardId }, 'discord shard disconnected'),
  );
  client.on(Events.ShardResume, (shardId) => logger.info({ shardId }, 'discord shard resumed'));

  const ready = new Promise<Client<true>>((resolve) => client.once(Events.ClientReady, resolve));
  try {
    await client.login(token);
  } catch (error) {
    if (error instanceof Error && error.message === 'Used disallowed intents') {
      throw new Error(
        'Discord rejected the privileged intents. Enable "Server Members Intent" in the ' +
          'Developer Portal (Bot tab → Privileged Gateway Intents) and restart.',
        { cause: error },
      );
    }
    throw error;
  }
  const readyClient = await ready;

  const guild = await readyClient.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    throw new Error(
      `The bot is not in guild ${guildId}. Invite it first (see docs/SERVER_LAYOUT.md §4).`,
    );
  }

  logger.info(
    { user: readyClient.user.tag, guild: guild.name, guildId: guild.id },
    'connected to Discord',
  );
  return guild;
}
