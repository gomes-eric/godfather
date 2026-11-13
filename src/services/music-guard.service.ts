import { MessageType, type Message } from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import type { GuildDirectory } from '../discord/directory.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';

const NOTICE_EVERY_MS = 10 * 60_000;
/** How long the in-channel notice stays before the bot deletes it. */
const NOTICE_LIFETIME_MS = 10_000;

/** Remembers who was told recently, so nobody gets a notice for every deleted message. */
export class NoticeThrottle {
  private readonly lastNotice = new Map<string, number>();

  constructor(
    private readonly everyMs = NOTICE_EVERY_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** True if this user should be told now (and records that they were). */
  take(userId: string): boolean {
    const now = this.now();
    const last = this.lastNotice.get(userId);
    if (last !== undefined && now - last < this.everyMs) return false;
    this.lastNotice.set(userId, now);
    return true;
  }
}

/**
 * Messages that stay in #musica: anything from a bot (music bots answering, slash command
 * replies), Discord's own system messages, and text commands for a music bot (`m!play ...`).
 * Anything else a person types is removed.
 */
export function keepInMusicChannel(
  message: { authorIsBot: boolean; system: boolean; content: string },
  commandPrefixes: readonly string[],
): boolean {
  if (message.authorIsBot || message.system) return true;
  const text = message.content.trimStart().toLowerCase();
  return commandPrefixes.some((prefix) => text.startsWith(prefix.toLowerCase()));
}

/**
 * A text command for a music bot: one of the prefixes (`m!play`) or a mention of a music bot at the
 * start (`@Jockie Music play`), which Jockie also takes as a prefix.
 */
export function isMusicCommand(
  content: string,
  commandPrefixes: readonly string[],
  musicBotIds: ReadonlySet<string>,
): boolean {
  const text = content.trimStart().toLowerCase();
  if (commandPrefixes.some((prefix) => text.startsWith(prefix.toLowerCase()))) return true;
  const mention = /^<@!?(\d+)>/.exec(text);
  return mention !== null && musicBotIds.has(mention[1]!);
}

const USER_TYPES = new Set([MessageType.Default, MessageType.Reply]);

/**
 * Keeps music where it belongs (PLAN.md §6.7): #musica holds only music commands, and a music
 * command typed in any other text channel (not a voice channel's chat) is deleted. The music bots
 * can't see those channels anyway, so the command would only sit there unanswered.
 */
export class MusicGuardService {
  private readonly throttle = new NoticeThrottle();

  constructor(
    private readonly deps: { directory: GuildDirectory; config: ConfigStore; logger: Logger },
  ) {}

  async onMessage(message: Message): Promise<void> {
    if (!message.inGuild()) return;
    const { musicGuard } = this.deps.config.get().settings;
    const channel = this.deps.directory.channelByKey(musicGuard.channel);
    if (!channel) return;
    if (message.channelId !== channel.id) {
      await this.outsideMusicChannel(message, channel.id);
      return;
    }
    if (
      keepInMusicChannel(
        {
          authorIsBot: message.author.bot,
          system: !USER_TYPES.has(message.type),
          content: message.content,
        },
        musicGuard.commandPrefixes,
      )
    ) {
      return;
    }

    await message.delete();
    this.deps.logger.debug(
      { user: message.author.tag },
      'removed a non-command message from #musica',
    );
    await this.tell(message, ptBR.music.notice(message.author.id, musicGuard.commandPrefixes));
  }

  /** Deletes a music command typed outside #musica and the voice channels' chat. */
  private async outsideMusicChannel(message: Message<true>, musicChannelId: string): Promise<void> {
    if (message.author.bot || !USER_TYPES.has(message.type)) return;
    if (message.channel.isVoiceBased()) return;
    // Any other bot mentioned at the start is taken as a music bot; Padrinho is not one.
    const musicBotIds = new Set(
      message.mentions.users
        .filter((user) => user.bot && user.id !== message.client.user.id)
        .map((user) => user.id),
    );
    const { commandPrefixes } = this.deps.config.get().settings.musicGuard;
    if (!isMusicCommand(message.content, commandPrefixes, musicBotIds)) return;

    await message.delete();
    this.deps.logger.debug(
      { user: message.author.tag, channel: message.channelId },
      'removed a music command outside #musica',
    );
    await this.tell(message, ptBR.music.elsewhere(message.author.id, musicChannelId));
  }

  // No DMs: a deleted message has no interaction to answer privately, so the notice is a short
  // message in the same channel that mentions only the author and deletes itself.
  private async tell(message: Message<true>, content: string): Promise<void> {
    if (!this.throttle.take(message.author.id) || !message.channel.isSendable()) return;
    const notice = await message.channel.send({
      content,
      allowedMentions: { users: [message.author.id] },
    });
    setTimeout(() => void notice.delete().catch(() => undefined), NOTICE_LIFETIME_MS);
  }
}
