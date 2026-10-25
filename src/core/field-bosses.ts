import { z } from 'zod';
import type { BossTimer } from '../db/field-bosses.js';
import { localParts, zonedToUtc } from './schedule.js';

// Pure rules for respawn-based field bosses (PLAN.md §6.11).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DOWN_AFTER_MS = 15 * MINUTE;
const WARN_EVERY_MS = 6 * HOUR;

/**
 * Shape of questlog.gg's `fieldBoss.timers` tRPC response, checked strictly enough that a
 * format change fails loudly instead of producing wrong reminders.
 */
const questlogResponse = z.object({
  result: z.object({
    data: z.array(
      z.looseObject({
        id: z.number().int(),
        alive: z.boolean(),
        time: z.number().int().positive(),
        seenAt: z.number().int().positive(),
      }),
    ),
  }),
});

export interface BossReading {
  questlogId: number;
  alive: boolean;
  /** When it respawns, for a dead boss. */
  respawnAt: Date | null;
  seenAt: Date;
}

export class FeedFormatError extends Error {
  override name = 'FeedFormatError';
}

export function parseQuestlogTimers(json: unknown): BossReading[] {
  const result = questlogResponse.safeParse(json);
  if (!result.success) {
    throw new FeedFormatError(
      `unexpected questlog.gg response: ${result.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`,
    );
  }
  return result.data.result.data.map((entry) => ({
    questlogId: entry.id,
    alive: entry.alive,
    respawnAt: entry.alive ? null : new Date(entry.time),
    seenAt: new Date(entry.seenAt),
  }));
}

/**
 * Applies a feed reading to the stored timer. A manual entry wins until its respawn passes;
 * returns null when nothing should change.
 */
export function mergeReading(
  bossKey: string,
  current: BossTimer | undefined,
  reading: BossReading,
  now: Date,
): BossTimer | null {
  if (current?.source === 'manual' && current.respawnAt && current.respawnAt > now) return null;

  const next: BossTimer = {
    bossKey,
    alive: reading.alive,
    respawnAt: reading.respawnAt,
    seenAt: reading.seenAt,
    source: 'questlog',
    overrideBy: null,
    updatedAt: now,
  };
  const unchanged =
    current?.source === 'questlog' &&
    current.alive === next.alive &&
    current.respawnAt?.getTime() === next.respawnAt?.getTime() &&
    current.seenAt.getTime() === next.seenAt.getTime();
  return unchanged ? null : next;
}

export type HealthProblem = 'down' | 'format' | 'stale';

/** What is wrong with the feed right now, if anything worth telling the officers. */
export function healthProblem(input: {
  /** First failed poll since the last success, if the feed is failing. */
  failingSince: Date | null;
  formatError: boolean;
  /** Oldest reading among the tracked bosses. */
  oldestSeenAt: Date | null;
  staleAfterHours: number;
  now: Date;
}): HealthProblem | null {
  const now = input.now.getTime();
  if (input.formatError) return 'format';
  if (input.failingSince && now - input.failingSince.getTime() > DOWN_AFTER_MS) return 'down';
  if (input.oldestSeenAt && now - input.oldestSeenAt.getTime() > input.staleAfterHours * HOUR) {
    return 'stale';
  }
  return null;
}

/** At most one warning every 6 hours. */
export function canWarn(lastWarnedAt: Date | null, now: Date): boolean {
  return !lastWarnedAt || now.getTime() - lastWarnedAt.getTime() >= WARN_EVERY_MS;
}

/**
 * What officers type in /boss set, read in the server timezone:
 * "09:16" / "9h16" → the next time the clock shows that (today or tomorrow);
 * "em 5h44m" / "5h44m" / "5h" / "44m" / "44min" → that long from now.
 */
export function parseBossTime(input: string, now: Date, timeZone: string): Date | null {
  const text = input
    .trim()
    .toLowerCase()
    .replace(/^em\s+/, '');

  const duration = text.match(/^(?:(\d{1,2})\s*h)?\s*(?:(\d{1,3})\s*m(?:in)?)?$/);
  if (duration && (duration[1] || duration[2]) && !/^\d{1,2}h\d{2}$/.test(text)) {
    const minutes = Number(duration[1] ?? 0) * 60 + Number(duration[2] ?? 0);
    return minutes > 0 ? new Date(now.getTime() + minutes * MINUTE) : null;
  }

  const clock = text.match(/^(\d{1,2})[:h](\d{2})$/);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    if (hour > 23 || minute > 59) return null;
    const today = localParts(now, timeZone);
    let instant = zonedToUtc(today, { hour, minute }, timeZone);
    if (instant <= now) {
      const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
      instant = zonedToUtc(
        {
          year: tomorrow.getUTCFullYear(),
          month: tomorrow.getUTCMonth() + 1,
          day: tomorrow.getUTCDate(),
        },
        { hour, minute },
        timeZone,
      );
    }
    return instant;
  }
  return null;
}
