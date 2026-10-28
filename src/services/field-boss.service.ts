import type { FieldBossConfig } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import {
  canWarn,
  FeedFormatError,
  healthProblem,
  mergeReading,
  parseBossTime,
  parseQuestlogTimers,
} from '../core/field-bosses.js';
import type { BossTimer, FieldBossStore } from '../db/field-bosses.js';
import { ptBR } from '../i18n/pt-BR.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import { unixSeconds as unix } from '../core/schedule.js';
import type { Logger } from '../logger.js';
import { fetchJsonAsBrowser, type FetchJson } from './fetch-json.js';
import type { OccurrenceSource, OccurrenceView } from './reminder.scheduler.js';

const t = ptBR.bosses;
const BOSS_PREFIX = 'boss:';
const PROVIDER = 'questlog';
const LOOKBACK_MS = 15 * 60_000;

export interface BossStatus {
  boss: FieldBossConfig;
  timer: BossTimer | undefined;
}

export type PollResult = 'disabled' | 'ok' | 'failed';

interface Deps {
  store: FieldBossStore;
  config: ConfigStore;
  runAction: ActionRunner;
  logger: Logger;
  /** Posts a warning for the officers (the bot sends it to #audit-log). */
  warn: (text: string) => Promise<void>;
  /** Called after any timer change so reminders move right away. */
  onChange?: () => void;
  fetchFeed?: FetchJson;
  now?: () => Date;
}

/**
 * Respawn-based field bosses (PLAN.md §6.11): reads the questlog.gg feed, accepts manual
 * corrections, and feeds the respawns to the reminder scheduler as occurrences.
 */
export class FieldBossService implements OccurrenceSource, BackgroundJob {
  readonly prefix = BOSS_PREFIX;
  private readonly now: () => Date;
  private readonly fetchFeed: FetchJson;
  private failingSince: Date | null = null;
  private stopPolling: (() => void) | undefined;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
    this.fetchFeed = deps.fetchFeed ?? fetchJsonAsBrowser;
  }

  private settings() {
    return this.deps.config.get().fieldBosses;
  }

  private bosses(): FieldBossConfig[] {
    return (this.settings()?.bosses ?? []).filter((b) => b.enabled);
  }

  // ---- OccurrenceSource -------------------------------------------------------------------------

  occurrences(now: Date, until: Date): { key: string; startsAt: Date }[] {
    const from = now.getTime() - LOOKBACK_MS;
    return this.bosses().flatMap((boss) => {
      const respawnAt = this.deps.store.get(boss.key)?.respawnAt;
      return respawnAt && respawnAt.getTime() >= from && respawnAt <= until
        ? [{ key: `${BOSS_PREFIX}${boss.key}`, startsAt: respawnAt }]
        : [];
    });
  }

  view(
    key: string,
  ): Pick<OccurrenceView, 'title' | 'emoji' | 'description' | 'voiceChannelId' | 'ping'> | null {
    const boss = this.bosses().find((b) => `${BOSS_PREFIX}${b.key}` === key);
    if (!boss) return null;
    const timer = this.deps.store.get(boss.key);
    const source = timer ? this.sourceLabel(timer) : null;
    const lines = [
      ...(boss.region ? [t.region(boss.region)] : []),
      ...(source ? [t.reminderSource(source)] : []),
    ];
    return {
      title: boss.title,
      emoji: boss.emoji,
      description: lines.length > 0 ? lines.join(' · ') : null,
      voiceChannelId: null,
      ping: this.deps.config.get().settings.eventDefaults.ping === 'everyone',
    };
  }

  offsets(): number[] {
    return this.settings()?.reminderOffsetsMinutes ?? [30, 0];
  }

  private sourceLabel(timer: BossTimer): string {
    return timer.source === 'manual' && timer.overrideBy
      ? t.sourceManual(timer.overrideBy)
      : t.sourceQuestlog(unix(timer.seenAt));
  }

  // ---- Status and corrections -------------------------------------------------------------------

  feedEnabled(): boolean {
    return this.settings()?.source.enabled ?? false;
  }

  status(): BossStatus[] {
    return this.bosses().map((boss) => ({ boss, timer: this.deps.store.get(boss.key) }));
  }

  describe({ boss, timer }: BossStatus): string {
    const state = !timer
      ? t.unknownStatus
      : timer.alive
        ? t.alive
        : timer.respawnAt
          ? t.respawn(unix(timer.respawnAt))
          : t.unknownStatus;
    const source = timer ? ` · ${this.sourceLabel(timer)}` : '';
    return `${boss.emoji} **${boss.title}** — ${state}${source}`;
  }

  /** Finds a boss by key or by part of its name, ignoring accents and case. */
  resolve(input: string): FieldBossConfig | undefined {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
    const needle = normalize(input);
    return this.bosses().find((b) => b.key === needle || normalize(b.title).includes(needle));
  }

  private manualTimer(boss: FieldBossConfig, respawnAt: Date, actor: Actor): BossTimer {
    const now = this.now();
    return {
      bossKey: boss.key,
      alive: false,
      respawnAt,
      seenAt: now,
      source: 'manual',
      overrideBy: actor.userId,
      updatedAt: now,
    };
  }

  private applyOverride(actor: Actor, boss: FieldBossConfig, respawnAt: Date, how: string) {
    return this.deps.runAction({
      actor,
      action: 'boss.override',
      target: boss.title,
      params: { boss: boss.key, respawnAt: respawnAt.toISOString(), how },
      preview: boss.title,
      execute: async () => {
        this.deps.store.upsert(this.manualTimer(boss, respawnAt, actor));
        this.deps.onChange?.();
        return t.set(boss.title, unix(respawnAt));
      },
    });
  }

  async set(actor: Actor, bossInput: string, time: string): Promise<ServiceOutcome<string>> {
    const boss = this.resolve(bossInput);
    if (!boss) return rejected(t.unknown(bossInput));
    const respawnAt = parseBossTime(time, this.now(), this.deps.config.get().settings.timezone);
    if (!respawnAt) return rejected(t.badTime);
    return this.applyOverride(actor, boss, respawnAt, `set ${time}`);
  }

  async killed(actor: Actor, bossInput: string): Promise<ServiceOutcome<string>> {
    const boss = this.resolve(bossInput);
    if (!boss) return rejected(t.unknown(bossInput));
    if (!boss.respawnMinutes) return rejected(t.noRespawn(boss.title));
    const respawnAt = new Date(this.now().getTime() + boss.respawnMinutes * 60_000);
    return this.applyOverride(actor, boss, respawnAt, 'killed');
  }

  async clear(actor: Actor, bossInput: string): Promise<ServiceOutcome<string>> {
    const boss = this.resolve(bossInput);
    if (!boss) return rejected(t.unknown(bossInput));
    if (this.deps.store.get(boss.key)?.source !== 'manual') {
      return rejected(t.nothingToClear(boss.title));
    }
    return this.deps.runAction({
      actor,
      action: 'boss.override',
      target: boss.title,
      params: { boss: boss.key, how: 'clear' },
      preview: boss.title,
      execute: async () => {
        this.deps.store.delete(boss.key);
        this.deps.onChange?.();
        void this.poll().catch(() => undefined);
        return t.cleared(boss.title);
      },
    });
  }

  // ---- questlog.gg feed -------------------------------------------------------------------------

  feedUrl(): string | null {
    const source = this.settings()?.source;
    if (!source) return null;
    const input = encodeURIComponent(JSON.stringify({ server: source.serverId, language: 'pt' }));
    return `https://questlog.gg/aion-2/api/trpc/fieldBoss.timers?input=${input}`;
  }

  /** One poll of the feed: store new readings, then check the feed's health. */
  async poll(): Promise<PollResult> {
    const settings = this.settings();
    const url = this.feedUrl();
    if (!settings?.source.enabled || !url) return 'disabled';

    const now = this.now();
    const health = this.deps.store.health(PROVIDER);
    let formatError = false;
    let result: PollResult = 'ok';

    try {
      const readings = parseQuestlogTimers(await this.fetchFeed(url));
      let changed = false;
      for (const boss of this.bosses()) {
        const reading = readings.find((r) => r.questlogId === boss.questlogId);
        if (!reading) continue;
        const next = mergeReading(boss.key, this.deps.store.get(boss.key), reading, now);
        if (next) {
          this.deps.store.upsert(next);
          changed = true;
        }
      }
      this.failingSince = null;
      health.lastOkAt = now;
      health.lastError = null;
      if (changed) this.deps.onChange?.();
    } catch (error) {
      result = 'failed';
      formatError = error instanceof FeedFormatError;
      this.failingSince ??= now;
      health.lastErrorAt = now;
      health.lastError = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn({ err: error }, 'field boss feed failed');
    }

    const questlogReadings = this.bosses()
      .map((b) => this.deps.store.get(b.key))
      .filter((timer): timer is BossTimer => timer?.source === 'questlog');
    const oldestSeenAt =
      questlogReadings.length > 0
        ? new Date(Math.min(...questlogReadings.map((timer) => timer.seenAt.getTime())))
        : null;
    const problem = healthProblem({
      failingSince: this.failingSince,
      formatError,
      oldestSeenAt,
      staleAfterHours: settings.source.staleAfterHours,
      now,
    });
    if (problem && canWarn(health.lastWarnedAt, now)) {
      await this.deps
        .warn(t.warnings[problem])
        .catch((error: unknown) =>
          this.deps.logger.warn({ err: error }, 'could not post the field boss warning'),
        );
      health.lastWarnedAt = now;
    }
    this.deps.store.saveHealth(health);
    return result;
  }

  start(): void {
    const intervalMs = (this.settings()?.source.pollIntervalSeconds ?? 180) * 1000;
    this.stopPolling = repeat(
      intervalMs,
      () => this.poll(),
      (error) => this.deps.logger.error({ err: error }, 'field boss poll crashed'),
    );
  }

  stop(): void {
    this.stopPolling?.();
  }
}
