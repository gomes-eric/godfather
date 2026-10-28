import type { ConfigStore } from '../config/store.js';
import { parseNews, type NewsPost } from '../core/news.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import type { NewsStore } from '../db/news.js';
import type { GuildDirectory } from '../discord/directory.js';
import { digestMessage, newsMessage, type DigestPing } from '../discord/news.js';
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
  /** Claude summaries; used when `settings.news.summary` is set. */
  summarizer?: NewsSummarizer;
  fetchJson?: FetchJson;
  now?: () => Date;
}

type NewsMessage = Parameters<SendableChannel['send']>[0];
type SendableChannel = NonNullable<ReturnType<GuildDirectory['channelByKey']>>;

/** How long a summary keeps being retried before the plain card goes out instead. */
const FALLBACK_AFTER_MS = 12 * 60 * 60_000;

/**
 * Posts a card in #noticias for each of the game's Steam announcements (patch notes, maintenance,
 * events, account restrictions…) when it comes out, in Brazilian Portuguese. The first run posts
 * only the latest one, so the channel doesn't fill up with history.
 *
 * With summaries on, Claude reads the post in whatever language Steam gives (the Portuguese slot
 * sometimes holds English or French) and always writes the card in Brazilian Portuguese, with only
 * what matters to the legion, or leaves the post out; it pings everyone when the post concerns
 * Triniel, and the roles of changed classes. Without them, the plain card goes out as it came.
 */
export class NewsService implements BackgroundJob {
  private readonly fetchJson: FetchJson;
  private readonly now: () => Date;
  /** Posts whose failed summary was already logged. */
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

  /** Who a summary pings: everyone for Triniel, and the class roles that exist in Discord. */
  private ping(digest: NewsDigest): DigestPing {
    return {
      everyone: digest.triniel,
      roleIds: digest.classes
        .map((key) => this.deps.directory.roleId(key))
        .filter((id): id is string => id !== undefined),
    };
  }

  /**
   * Summarizes the latest `count` posts and posts the cards in `channelKey` without pinging
   * anyone, saying who would be pinged; returns one line per post. For officers to judge the
   * summaries before they go to #noticias.
   */
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
      const ping = this.ping(digest);
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

  /** What to post for a new announcement: 'skip' to mark it seen, null to retry on a later poll. */
  private async messageFor(note: NewsPost): Promise<NewsMessage | 'skip' | null> {
    if (this.deps.summarizer && this.settings()?.summary) {
      try {
        const digest = await this.deps.summarizer.digest(note);
        if (digest.publish) return digestMessage(note, digest, this.ping(digest));
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

  /** Posts every announcement not posted yet, oldest first; returns how many were posted. */
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
