import type { ConfigStore } from '../config/store.js';
import { looksPortuguese, parseNews, type NewsPost } from '../core/news.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import type { NewsStore } from '../db/news.js';
import type { GuildDirectory } from '../discord/directory.js';
import { newsMessage } from '../discord/news.js';
import type { Logger } from '../logger.js';
import { fetchJson, type FetchJson } from './fetch-json.js';

const EVENTS_URL = 'https://store.steampowered.com/events/ajaxgetpartnereventspageable/';

interface Deps {
  config: ConfigStore;
  directory: GuildDirectory;
  store: NewsStore;
  logger: Logger;
  fetchJson?: FetchJson;
  now?: () => Date;
}

/** How long a post in the wrong language waits for Steam's fix before going out in English. */
const FALLBACK_AFTER_MS = 12 * 60 * 60_000;

/**
 * Posts a card in #noticias for each of the game's Steam announcements (patch notes, maintenance,
 * events, account restrictions…) when it comes out, in Brazilian Portuguese. The first run posts
 * only the latest one, so the channel doesn't fill up with history. A post whose Portuguese text is
 * in another language waits for Steam's fix, then falls back to English.
 */
export class NewsService implements BackgroundJob {
  private readonly fetchJson: FetchJson;
  private readonly now: () => Date;
  /** Posts already logged as waiting for their Portuguese text. */
  private readonly waiting = new Set<string>();

  constructor(private readonly deps: Deps) {
    this.fetchJson = deps.fetchJson ?? ((url) => fetchJson(url, 15_000));
    this.now = deps.now ?? (() => new Date());
  }

  private settings() {
    return this.deps.config.get().settings.news;
  }

  async latest(language: 'brazilian' | 'english' = 'brazilian'): Promise<NewsPost[]> {
    const settings = this.settings();
    if (!settings) return [];
    const query = new URLSearchParams({
      appid: String(settings.steamAppId),
      offset: '0',
      count: '20',
      l: language,
    });
    return parseNews(await this.fetchJson(`${EVENTS_URL}?${query}`), settings.steamAppId);
  }

  /**
   * The post to send, or null to wait: one whose Portuguese text came in another language waits
   * for Steam to fix it, and after FALLBACK_AFTER_MS goes out in English.
   */
  private async inPortuguese(
    note: NewsPost,
    english: () => Promise<NewsPost[]>,
  ): Promise<NewsPost | null> {
    if (looksPortuguese(note)) return note;
    if (this.now().getTime() - note.postedAt.getTime() < FALLBACK_AFTER_MS) {
      if (!this.waiting.has(note.id)) {
        this.waiting.add(note.id);
        this.deps.logger.warn({ title: note.title }, 'news not in Portuguese yet; waiting');
      }
      return null;
    }
    return (await english()).find((post) => post.id === note.id) ?? note;
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

    let englishFeed: Promise<NewsPost[]> | undefined;
    const english = () => (englishFeed ??= this.latest('english'));
    let posted = 0;
    for (const candidate of candidates) {
      const note = await this.inPortuguese(candidate, english);
      if (!note) continue;
      const sent = await channel.send({
        ...newsMessage(note),
        allowedMentions: { parse: [] },
      });
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
