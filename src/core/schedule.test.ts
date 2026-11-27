import { describe, expect, it } from 'vitest';
import {
  localParts,
  normalizeClock,
  parseDays,
  parseWhen,
  reminderDecision,
  templateOccurrences,
  zonedToUtc,
} from './schedule.js';

const SP = 'America/Sao_Paulo';
const now = new Date('2026-10-25T06:30:00Z');
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('zonedToUtc / localParts', () => {
  it('converts São Paulo wall time to UTC (UTC-3, no DST)', () => {
    expect(iso(zonedToUtc({ year: 2026, month: 10, day: 26 }, { hour: 21, minute: 0 }, SP))).toBe(
      '2026-10-27T00:00:00.000Z',
    );
  });

  it('handles a zone with DST', () => {
    const before = zonedToUtc(
      { year: 2026, month: 10, day: 31 },
      { hour: 12, minute: 0 },
      'America/New_York',
    );
    const after = zonedToUtc(
      { year: 2026, month: 11, day: 2 },
      { hour: 12, minute: 0 },
      'America/New_York',
    );
    expect(iso(before)).toBe('2026-10-31T16:00:00.000Z');
    expect(iso(after)).toBe('2026-11-02T17:00:00.000Z');
  });

  it('reads the local weekday', () => {
    expect(localParts(now, SP)).toMatchObject({ weekday: 'sun', hour: 3, minute: 30 });
  });
});

describe('templateOccurrences', () => {
  it('lists the Abyss war (mon/thu/sat 21:00) for the next 7 days', () => {
    const week = templateOccurrences(
      { days: ['mon', 'thu', 'sat'], time: '21:00' },
      now,
      new Date(now.getTime() + 7 * 24 * 3600_000),
      SP,
    );
    expect(week.map(iso)).toEqual([
      '2026-10-27T00:00:00.000Z',
      '2026-10-30T00:00:00.000Z',
      '2026-11-01T00:00:00.000Z',
    ]);
  });

  it('supports daily templates and skips times already past', () => {
    const day = templateOccurrences(
      { days: ['daily'], time: '03:00' },
      now,
      new Date(now.getTime() + 24 * 3600_000),
      SP,
    );
    expect(day.map(iso)).toEqual(['2026-10-26T06:00:00.000Z']);
  });
});

describe('reminderDecision', () => {
  const due = new Date('2026-10-27T00:00:00Z');
  const at = (minutes: number) => new Date(due.getTime() + minutes * 60_000);

  it('waits until due, then sends', () => {
    expect(reminderDecision(due, at(-1), 30)).toBe('wait');
    expect(reminderDecision(due, at(0), 30)).toBe('send');
  });

  it('skips advance warnings more than 5 minutes late', () => {
    expect(reminderDecision(due, at(5), 30)).toBe('send');
    expect(reminderDecision(due, at(6), 30)).toBe('skip');
  });

  it('gives the "starting now" reminder 10 minutes', () => {
    expect(reminderDecision(due, at(9), 0)).toBe('send');
    expect(reminderDecision(due, at(11), 0)).toBe('skip');
  });
});

describe('parseWhen', () => {
  it.each([
    ['30/10 21:00', '2026-10-31T00:00:00.000Z'],
    ['30/10 21h', '2026-10-31T00:00:00.000Z'],
    ['30/10/2026 20:30', '2026-10-30T23:30:00.000Z'],
    ['2026-10-30 21:00', '2026-10-31T00:00:00.000Z'],
    ['hoje 21h', '2026-10-26T00:00:00.000Z'],
    ['amanhã 20:30', '2026-10-26T23:30:00.000Z'],
    ['Amanha 9', '2026-10-26T12:00:00.000Z'],
    ['sáb 21h', '2026-11-01T00:00:00.000Z'],
    ['sexta-feira 20:00', '2026-10-30T23:00:00.000Z'],
    ['dom 22:00', '2026-10-26T01:00:00.000Z'],
    ['dom 02:00', '2026-11-01T05:00:00.000Z'],
    ['05/01 21:00', '2027-01-06T00:00:00.000Z'],
  ])('%s → %s', (input, expected) => {
    expect(iso(parseWhen(input, now, SP))).toBe(expected);
  });

  it.each(['amanhã', '31/02 21:00', '30/10 25:00', 'quando der', 'sab'])('rejects %s', (input) => {
    expect(parseWhen(input, now, SP)).toBeNull();
  });
});

describe('normalizeClock', () => {
  it('accepts the ways people type a time', () => {
    expect(['21', '21h', '9:30', '21:00', '9h30'].map(normalizeClock)).toEqual([
      '21:00',
      '21:00',
      '09:30',
      '21:00',
      '09:30',
    ]);
    expect(normalizeClock('meio-dia')).toBe('meio-dia');
  });
});

describe('parseDays', () => {
  it('accepts English and Portuguese day names', () => {
    expect(parseDays('mon,thu,sat')).toEqual(['mon', 'thu', 'sat']);
    expect(parseDays('seg qui sáb')).toEqual(['mon', 'thu', 'sat']);
    expect(parseDays('sexta, domingo')).toEqual(['fri', 'sun']);
    expect(parseDays('todo dia')).toEqual(['daily']);
    expect(parseDays('someday')).toBeNull();
  });
});
