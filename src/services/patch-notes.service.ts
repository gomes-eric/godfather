import type { ConfigStore } from '../config/store.js';
import { parsePatchNotes, type PatchNote } from '../core/patch-notes.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import type { PatchNoteStore } from '../db/patch-notes.js';
import type { GuildDirectory } from '../discord/directory.js';
import { patchNoteMessage } from '../discord/patch-notes.js';
import type { Logger } from '../logger.js';
import { fetchJson, type FetchJson } from './fetch-json.js';

const EVENTS_URL = 'https://store.steampowered.com/events/ajaxgetpartnereventspageable/';

interface Deps {
  config: ConfigStore;
  directory: GuildDirectory;
  store: PatchNoteStore;
  logger: Logger;
  fetchJson?: FetchJson;
}

/**
 * Posts a card for the game's patch notes in #patch-notes when they come out, read from the game's
 * Steam announcements in Brazilian Portuguese. The first run posts only the latest notes, so the
 * channel doesn't fill up with history.
 */
export class PatchNotesService implements BackgroundJob {
  private stopPolling: (() => void) | undefined;
  private readonly fetchJson: FetchJson;

  constructor(private readonly deps: Deps) {
    this.fetchJson = deps.fetchJson ?? ((url) => fetchJson(url, 15_000));
  }

  private settings() {
    return this.deps.config.get().settings.patchNotes;
  }

  async latest(): Promise<PatchNote[]> {
    const settings = this.settings();
    if (!settings) return [];
    const query = new URLSearchParams({
      appid: String(settings.steamAppId),
      offset: '0',
      count: '20',
      l: 'brazilian',
    });
    return parsePatchNotes(
      await this.fetchJson(`${EVENTS_URL}?${query}`),
      settings.steamAppId,
      settings.titleMatches,
    );
  }

  /** Posts every patch note not posted yet; returns how many were posted. */
  async poll(): Promise<number> {
    const settings = this.settings();
    if (!settings) return 0;
    const channel = this.deps.directory.channelByKey(settings.channel);
    if (!channel) return 0;

    const notes = await this.latest();
    const firstRun = this.deps.store.isEmpty();
    const fresh = notes.filter((note) => !this.deps.store.has(note.id));
    const toPost = firstRun ? fresh.slice(-1) : fresh;
    if (firstRun) {
      for (const note of fresh.slice(0, -1)) this.deps.store.add(note.id, null);
    }

    for (const note of toPost) {
      const sent = await channel.send({
        ...patchNoteMessage(note),
        allowedMentions: { parse: [] },
      });
      this.deps.store.add(note.id, sent.id);
      this.deps.logger.info({ title: note.title }, 'patch notes posted');
    }
    return toPost.length;
  }

  start(): void {
    const minutes = this.settings()?.pollMinutes ?? 15;
    this.stopPolling = repeat(
      minutes * 60_000,
      () => this.poll(),
      (error) => this.deps.logger.warn({ err: error }, 'patch notes poll failed'),
    );
  }

  stop(): void {
    this.stopPolling?.();
  }
}
