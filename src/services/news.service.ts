import { classRoles } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import { parseNews, type NewsPost } from '../core/news.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import type { NewsStore } from '../db/news.js';
import type { GuildDirectory } from '../discord/directory.js';
import { digestDescription, digestMessage, newsMessage, type DigestPing } from '../discord/news.js';
import type { NewsDigest } from '../core/news-digest.js';
import type { Logger } from '../logger.js';
import { ptBR } from '../i18n/pt-BR.js';
import { fetchJson, type FetchJson } from './fetch-json.js';
import type { NewsSummarizer } from './news-summarizer.js';

const t = ptBR.news;
const EVENTS_URL = 'https://store.steampowered.com/events/ajaxgetpartnereventspageable/';

interface Deps {
  config: ConfigStore;
  directory: GuildDirectory;
  store: NewsStore;
  logger: Logger;
  summarizer?: NewsSummarizer;
  fetchJson?: FetchJson;
  now?: () => Date;
}

type NewsMessage = Parameters<SendableChannel['send']>[0];
type SendableChannel = NonNullable<ReturnType<GuildDirectory['channelByKey']>>;

const FALLBACK_AFTER_MS = 12 * 60 * 60_000;

export class NewsService implements BackgroundJob {
  private readonly fetchJson: FetchJson;
  private readonly now: () => Date;
  private readonly waiting = new Set<string>();

  constructor(private readonly deps: Deps) {
    this.fetchJson = deps.fetchJson ?? ((url) => fetchJson(url, 15_000));
    this.now = deps.now ?? (() => new Date());
  }

  private settings() {
    return this.deps.config.get().settings.news;
  }

  async latest(): Promise<NewsPost[]> {
    const settings = this.settings();
    if (!settings) return [];
    const query = new URLSearchParams({
      appid: String(settings.steamAppId),
      offset: '0',
      count: '20',
      l: 'brazilian',
    });
    return parseNews(await this.fetchJson(`${EVENTS_URL}?${query}`), settings.steamAppId);
  }

  private ping(digest: NewsDigest, note: Pick<NewsPost, 'title' | 'body'>): DigestPing {
    const classes = classRoles(this.deps.config.get());
    const general = digest.classes.length * 2 >= classes.length;
    const card = digestDescription(digest).toLowerCase();
    const named = (key: string) => {
      const name = classes.find((role) => role.key === key)?.name;
      return name !== undefined && card.includes(name.toLowerCase());
    };
    return {
      everyone: digest.triniel && /triniel/i.test(`${note.title}\n${note.body}`),
      roleIds: general
        ? []
        : digest.classes
            .filter(named)
            .map((key) => this.deps.directory.roleId(key))
            .filter((id): id is string => id !== undefined),
    };
  }

  async preview(count: number, channelKey: string): Promise<string[]> {
    if (!this.deps.summarizer || !this.settings()?.summary) return [t.previewOff];
    const channel = this.deps.directory.channelByKey(channelKey);
    if (!channel) return [t.previewNoChannel(channelKey)];
    const lines: string[] = [];
    for (const note of (await this.latest()).slice(-count)) {
      const digest = await this.deps.summarizer.digest(note);
      if (!digest.publish) {
        lines.push(t.previewSkipped(note.title, digest.skipReason));
        continue;
      }
      const ping = this.ping(digest, note);
      const roles = ping.roleIds.map((id) => channel.guild.roles.cache.get(id)?.name ?? id);
      await channel.send({
        ...digestMessage(note, digest, { everyone: false, roleIds: [] }),
        content: t.previewHeader([...(ping.everyone ? ['@everyone'] : []), ...roles]),
        allowedMentions: { parse: [] },
      });
      lines.push(t.previewPosted(note.title));
    }
    return lines;
  }

  private async messageFor(note: NewsPost): Promise<NewsMessage | 'skip' | null> {
    if (this.deps.summarizer && this.settings()?.summary) {
      try {
        const digest = await this.deps.summarizer.digest(note);
        if (digest.publish) return digestMessage(note, digest, this.ping(digest, note));
        this.deps.logger.info({ title: note.title, reason: digest.skipReason }, 'news left out');
        return 'skip';
      } catch (error) {
        const young = this.now().getTime() - note.postedAt.getTime() < FALLBACK_AFTER_MS;
        if (!this.waiting.has(note.id)) {
          this.waiting.add(note.id);
          this.deps.logger.warn({ err: error, title: note.title }, 'news summary failed');
        }
        if (young) return null;
      }
    }
    return { ...newsMessage(note), allowedMentions: { parse: [] } };
  }

  async poll(): Promise<number> {
    const settings = this.settings();
    if (!settings) return 0;
    const channel = this.deps.directory.channelByKey(settings.channel);
    if (!channel) return 0;

    const notes = await this.latest();
    const firstRun = this.deps.store.isEmpty();
    const fresh = notes.filter((note) => !this.deps.store.has(note.id));
    const candidates = firstRun ? fresh.slice(-1) : fresh;
    if (firstRun) {
      for (const note of fresh.slice(0, -1)) this.deps.store.add(note.id, null);
    }

    let posted = 0;
    for (const note of candidates) {
      const message = await this.messageFor(note);
      if (message === 'skip') this.deps.store.add(note.id, null);
      if (message === 'skip' || message === null) continue;
      const sent = await channel.send(message);
      this.deps.store.add(note.id, sent.id);
      this.deps.logger.info({ title: note.title }, 'news posted');
      posted++;
    }
    return posted;
  }

  start(): () => void {
    const minutes = this.settings()?.pollMinutes ?? 15;
    return repeat(
      minutes * 60_000,
      () => this.poll(),
      (error) => this.deps.logger.warn({ err: error }, 'news poll failed'),
    );
  }
}
