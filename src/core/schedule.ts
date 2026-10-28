import { WEEKDAYS, type Weekday } from '../config/schema.js';
import { fold } from './text.js';

// Time rules for events and reminders (PLAN.md §6.4). Times in server.yaml are wall-clock times
// in the configured timezone (America/Sao_Paulo); everything stored is a UTC instant.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Seconds since the epoch, for Discord timestamps (`<t:…:R>`). */
export function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: Weekday;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock date and time of an instant in a timezone. */
export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: String(parts.weekday).toLowerCase().slice(0, 3) as Weekday,
  };
}

function offsetMs(instant: number, timeZone: string): number {
  const p = localParts(new Date(instant), timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return wall - Math.floor(instant / MINUTE) * MINUTE;
}

/** The instant when the wall clock in `timeZone` shows this date and time. */
export function zonedToUtc(
  date: { year: number; month: number; day: number },
  time: { hour: number; minute: number },
  timeZone: string,
): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  const first = guess - offsetMs(guess, timeZone);
  // Second pass settles DST transitions, where the offset at the guess differs from the result.
  return new Date(guess - offsetMs(first, timeZone));
}

function parseClock(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  return { hour: hour ?? 0, minute: minute ?? 0 };
}

/** Civil date `days` after the given one (no timezone involved). */
function addDays(date: { year: number; month: number; day: number }, days: number) {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: WEEKDAYS[d.getUTCDay()]!,
  };
}

/** Start instants of a recurring template within [from, to]. */
export function templateOccurrences(
  template: { days: (Weekday | 'daily')[]; time: string },
  from: Date,
  to: Date,
  timeZone: string,
): Date[] {
  const clock = parseClock(template.time);
  const start = localParts(from, timeZone);
  const span = Math.ceil((to.getTime() - from.getTime()) / DAY) + 1;
  const result: Date[] = [];
  for (let i = 0; i <= span; i++) {
    const date = addDays(start, i);
    if (!template.days.includes('daily') && !template.days.includes(date.weekday)) continue;
    const instant = zonedToUtc(date, clock, timeZone);
    if (instant >= from && instant <= to) result.push(instant);
  }
  return result;
}

export type ReminderDecision = 'wait' | 'send' | 'skip';

/**
 * A reminder that is late by more than the tolerance (the bot was off) is skipped instead of
 * sent late: 5 minutes for advance warnings, 10 for the "starting now" one (PLAN.md §6.4).
 */
export function reminderDecision(dueAt: Date, now: Date, offsetMinutes: number): ReminderDecision {
  const late = now.getTime() - dueAt.getTime();
  if (late < 0) return 'wait';
  const tolerance = (offsetMinutes === 0 ? 10 : 5) * MINUTE;
  return late > tolerance ? 'skip' : 'send';
}

const WEEKDAY_WORDS: Record<string, Weekday> = {
  dom: 'sun',
  domingo: 'sun',
  seg: 'mon',
  segunda: 'mon',
  ter: 'tue',
  terca: 'tue',
  qua: 'wed',
  quarta: 'wed',
  qui: 'thu',
  quinta: 'thu',
  sex: 'fri',
  sexta: 'fri',
  sab: 'sat',
  sabado: 'sat',
};

/**
 * Parses what officers type in /event create, in the server timezone:
 * "30/10 21:00", "30/10/2026 21h", "2026-10-30 21:00", "hoje 21h", "amanhã 20:30",
 * "sáb 21h" / "sexta 20:00" (the next such day; today if the time hasn't passed).
 * Returns null when the text isn't understood.
 */
export function parseWhen(input: string, now: Date, timeZone: string): Date | null {
  const text = fold(input).replace(/-feira/, '');
  const today = localParts(now, timeZone);

  const clockOf = (h: string | undefined, m: string | undefined) => {
    const hour = Number(h);
    const minute = m ? Number(m) : 0;
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
  };
  const validDate = (year: number, month: number, day: number) => {
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  };

  let match = text.match(/^(hoje|amanha)\s+(\d{1,2})(?:[:h](\d{2})?)?h?$/);
  if (match) {
    const clock = clockOf(match[2], match[3]);
    if (!clock) return null;
    return zonedToUtc(addDays(today, match[1] === 'amanha' ? 1 : 0), clock, timeZone);
  }

  match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})$/);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const clock = clockOf(match[4], match[5]);
    if (!clock || !validDate(year, month, day)) return null;
    return zonedToUtc({ year, month, day }, clock, timeZone);
  }

  match = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\s+(\d{1,2})(?:[:h](\d{2})?)?h?$/);
  if (match) {
    const [day, month] = [Number(match[1]), Number(match[2])];
    const explicitYear = match[3]
      ? Number(match[3].length === 2 ? `20${match[3]}` : match[3])
      : null;
    const clock = clockOf(match[4], match[5]);
    let year = explicitYear ?? today.year;
    if (!clock || !validDate(year, month, day)) return null;
    let instant = zonedToUtc({ year, month, day }, clock, timeZone);
    // "05/01" typed in December means next January.
    if (explicitYear === null && instant.getTime() < now.getTime() - DAY) {
      year += 1;
      if (!validDate(year, month, day)) return null;
      instant = zonedToUtc({ year, month, day }, clock, timeZone);
    }
    return instant;
  }

  match = text.match(/^([a-z]+)\s+(\d{1,2})(?:[:h](\d{2})?)?h?$/);
  const weekday = match ? WEEKDAY_WORDS[match[1]!] : undefined;
  if (match && weekday) {
    const clock = clockOf(match[2], match[3]);
    if (!clock) return null;
    for (let i = 0; i <= 7; i++) {
      const date = addDays(today, i);
      if (date.weekday !== weekday) continue;
      const instant = zonedToUtc(date, clock, timeZone);
      if (instant > now) return instant;
    }
  }
  return null;
}

/** "21", "21h", "9:30", "21:00" → "HH:MM". Anything else is passed through for the schema to reject. */
export function normalizeClock(input: string): string {
  const match = input.trim().match(/^(\d{1,2})(?:[:h](\d{2})?)?h?$/);
  return match ? `${match[1]!.padStart(2, '0')}:${match[2] ?? '00'}` : input;
}
