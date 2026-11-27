import { Client, Events, GatewayIntentBits, Options, type Guild } from 'discord.js';
import type { Logger } from '../logger.js';

// GuildMembers is a privileged intent: enable "Server Members Intent" in the Developer Portal.
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
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 20,
      GuildBanManager: 0,
    }),
  });
}

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
