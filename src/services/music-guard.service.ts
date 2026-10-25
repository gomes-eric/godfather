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

const USER_TYPES = new Set([MessageType.Default, MessageType.Reply]);

/** Keeps #musica for music commands only (PLAN.md §6.7). */
export class MusicGuardService {
  private readonly throttle = new NoticeThrottle();

  constructor(
    private readonly deps: { directory: GuildDirectory; config: ConfigStore; logger: Logger },
  ) {}

  async onMessage(message: Message): Promise<void> {
    if (!message.inGuild()) return;
    const { musicGuard } = this.deps.config.get().settings;
    const channel = this.deps.directory.channelByKey(musicGuard.channel);
    if (!channel || message.channelId !== channel.id) return;
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
    // No DMs: a deleted message has no interaction to answer privately, so the notice is a
    // short reply in the channel that mentions only the author and deletes itself.
    if (this.throttle.take(message.author.id)) {
      const notice = await channel.send({
        content: ptBR.music.notice(message.author.id, musicGuard.commandPrefixes),
        allowedMentions: { users: [message.author.id] },
      });
      setTimeout(() => void notice.delete().catch(() => undefined), NOTICE_LIFETIME_MS);
    }
  }
}
