import { MessageType, type Message } from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import type { GuildDirectory } from '../discord/directory.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';

const NOTICE_EVERY_MS = 10 * 60_000;

/** Remembers who was told recently, so nobody gets a DM for every deleted message. */
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
 * replies) and Discord's own system messages. Everything a person types is removed.
 */
export function keepInMusicChannel(message: { authorIsBot: boolean; system: boolean }): boolean {
  return message.authorIsBot || message.system;
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
    const channel = this.deps.directory.channelByKey(
      this.deps.config.get().settings.musicGuard.channel,
    );
    if (!channel || message.channelId !== channel.id) return;
    if (
      keepInMusicChannel({ authorIsBot: message.author.bot, system: !USER_TYPES.has(message.type) })
    ) {
      return;
    }

    await message.delete();
    this.deps.logger.debug(
      { user: message.author.tag },
      'removed a non-command message from #musica',
    );
    if (this.throttle.take(message.author.id)) {
      await message.author.send(ptBR.music.notice(channel.id)).catch(() => undefined); // DMs may be closed
    }
  }
}
