import { classRoles } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import {
  digestPing,
  gameClassName,
  type DigestClass,
  type NewsDigest,
} from '../core/news-digest.js';
import { parseNews, type NewsPost } from '../core/news.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import type { NewsStore } from '../db/news.js';
import { digestMessage, newsMessage, type NewsMessage } from '../discord/news.js';
import type { Logger } from '../logger.js';
import { ptBR } from '../i18n/pt-BR.js';
import { fetchJson, type FetchJson } from './fetch-json.js';
import type { NewsSummarizer } from './news-summarizer.js';

const t = ptBR.news;
const EVENTS_URL = 'https://store.steampowered.com/events/ajaxgetpartnereventspageable/';

export interface NewsChannel {
  post(message: NewsMessage): Promise<string>;
}

export interface NewsPort {
  channel(key: string): NewsChannel | undefined;
  roleId(key: string): string | undefined;
}

interface Deps {
  config: ConfigStore;
  port: NewsPort;
  store: NewsStore;
  logger: Logger;
  summarizer?: NewsSummarizer;
  fetchJson?: FetchJson;
  now?: () => Date;
}

interface Summaries {
  classes: DigestClass[];
  digest(note: NewsPost): Promise<NewsDigest>;
}

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

  private summaries(): Summaries | undefined {
    const { summarizer } = this.deps;
    const summary = this.settings()?.summary;
    if (!summarizer || !summary) return undefined;
    const classes = classRoles(this.deps.config.get()).map((role) => ({
      key: role.key,
      name: role.name,
      gameName: gameClassName(role.key),
    }));
    const options = { model: summary.model, classes };
    return { classes, digest: (note) => summarizer.digest(note, options) };
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

  private pings(digest: NewsDigest, note: NewsPost, classes: readonly DigestClass[]) {
    const { everyone, classKeys } = digestPing(digest, note, classes);
    const roles = classKeys.flatMap((key) => {
      const id = this.deps.port.roleId(key);
      const name = classes.find((c) => c.key === key)?.name;
      return id !== undefined && name !== undefined ? [{ id, name }] : [];
    });
    return { everyone, roles };
  }

  async preview(count: number, channelKey: string): Promise<string[]> {
    const summaries = this.summaries();
    if (!summaries) return [t.previewOff];
    const channel = this.deps.port.channel(channelKey);
    if (!channel) return [t.previewNoChannel(channelKey)];
    const lines: string[] = [];
    for (const note of (await this.latest()).slice(-count)) {
      const digest = await summaries.digest(note);
      if (!digest.publish) {
        lines.push(t.previewSkipped(note.title, digest.skipReason));
        continue;
      }
      const { everyone, roles } = this.pings(digest, note, summaries.classes);
      await channel.post({
        ...digestMessage(note, digest, { everyone: false, roleIds: [] }),
        content: t.previewHeader([...(everyone ? ['@everyone'] : []), ...roles.map((r) => r.name)]),
        allowedMentions: { parse: [] },
      });
      lines.push(t.previewPosted(note.title));
    }
    return lines;
  }

  private async messageFor(
    note: NewsPost,
    summaries: Summaries | undefined,
  ): Promise<NewsMessage | 'skip' | null> {
    if (summaries) {
      try {
        const digest = await summaries.digest(note);
        if (digest.publish) {
          const { everyone, roles } = this.pings(digest, note, summaries.classes);
          return digestMessage(note, digest, { everyone, roleIds: roles.map((r) => r.id) });
        }
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
    return newsMessage(note);
  }

  async poll(): Promise<number> {
    const settings = this.settings();
    if (!settings) return 0;
    const channel = this.deps.port.channel(settings.channel);
    if (!channel) return 0;

    const notes = await this.latest();
    const firstRun = this.deps.store.isEmpty();
    const fresh = notes.filter((note) => !this.deps.store.has(note.id));
    const candidates = firstRun ? fresh.slice(-1) : fresh;
    if (firstRun) {
      for (const note of fresh.slice(0, -1)) this.deps.store.add(note.id, null);
    }

    const summaries = this.summaries();
    let posted = 0;
    for (const note of candidates) {
      const message = await this.messageFor(note, summaries);
      if (message === 'skip') this.deps.store.add(note.id, null);
      if (message === 'skip' || message === null) continue;
      this.deps.store.add(note.id, await channel.post(message));
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
