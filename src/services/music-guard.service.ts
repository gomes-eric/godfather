import { MessageType, type Message } from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import { musicVerdict, type GuardedMessage } from '../core/music-guard.js';
import type { GuildDirectory } from '../discord/directory.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';

const NOTICE_EVERY_MS = 10 * 60_000;
const NOTICE_LIFETIME_MS = 10_000;

export class NoticeThrottle {
  private readonly lastNotice = new Map<string, number>();

  constructor(
    private readonly everyMs = NOTICE_EVERY_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  take(userId: string): boolean {
    const now = this.now();
    const last = this.lastNotice.get(userId);
    if (last !== undefined && now - last < this.everyMs) return false;
    this.lastNotice.set(userId, now);
    return true;
  }
}

export interface GuardTarget {
  authorId: string;
  delete(): Promise<void>;
  notify(content: string): Promise<{ delete(): Promise<unknown> } | null>;
}

const USER_TYPES = new Set([MessageType.Default, MessageType.Reply]);

function guarded(message: Message<true>, musicChannelId: string): GuardedMessage {
  return {
    inMusicChannel: message.channelId === musicChannelId,
    authorIsBot: message.author.bot,
    isUserMessage: USER_TYPES.has(message.type),
    inVoiceChat: message.channel.isVoiceBased(),
    content: message.content,
    mentionedBotIds: message.mentions.users.filter((user) => user.bot).map((user) => user.id),
    botId: message.client.user.id,
  };
}

function target(message: Message<true>): GuardTarget {
  return {
    authorId: message.author.id,
    delete: async () => {
      await message.delete();
    },
    notify: async (content) =>
      message.channel.isSendable()
        ? message.channel.send({ content, allowedMentions: { users: [message.author.id] } })
        : null,
  };
}

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
    const verdict = musicVerdict(guarded(message, channel.id), musicGuard);
    if (verdict === 'keep') return;

    const author = message.author.id;
    await this.remove(
      target(message),
      verdict.notice === 'here'
        ? ptBR.music.notice(author, musicGuard.commandPrefixes)
        : ptBR.music.elsewhere(author, channel.id),
    );
    this.deps.logger.debug(
      { user: message.author.tag, channel: message.channelId, notice: verdict.notice },
      'music guard removed a message',
    );
  }

  // No DMs: a deleted message has no interaction to answer privately, so the notice is a short
  // message in the same channel that mentions only the author and deletes itself.
  async remove(message: GuardTarget, notice: string): Promise<void> {
    await message.delete();
    if (!this.throttle.take(message.authorId)) return;
    const sent = await message.notify(notice);
    if (sent) setTimeout(() => void sent.delete().catch(() => undefined), NOTICE_LIFETIME_MS);
  }
}
