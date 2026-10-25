import { describe, expect, it } from 'vitest';
import type { BossTimer } from '../db/field-bosses.js';
import {
  canWarn,
  FeedFormatError,
  healthProblem,
  mergeReading,
  parseBossTime,
  parseQuestlogTimers,
} from './field-bosses.js';

// Real shape captured from questlog.gg on 2026-10-25 (Triniel, server 2403), trimmed.
const fixture = {
  result: {
    data: [
      {
        id: 111021,
        name: 'Gartua Imortal',
        alive: false,
        time: 1792930605885,
        seenAt: 1792910175669,
      },
      {
        id: 111022,
        name: 'Brigadeiro Lagta',
        alive: false,
        time: 1792931350583,
        seenAt: 1792910175669,
      },
      {
        id: 101001,
        name: 'Neikel of the East',
        alive: true,
        time: 1792902388493,
        seenAt: 1792907860211,
      },
    ],
  },
};

const now = new Date('2026-10-25T06:40:00Z');
const at = (iso: string) => new Date(iso);

describe('parseQuestlogTimers', () => {
  it('reads dead bosses with their respawn time and alive ones without', () => {
    const readings = parseQuestlogTimers(fixture);
    expect(readings[0]).toEqual({
      questlogId: 111021,
      alive: false,
      respawnAt: new Date(1792930605885),
      seenAt: new Date(1792910175669),
    });
    expect(readings[2]).toMatchObject({ questlogId: 101001, alive: true, respawnAt: null });
  });

  it('fails loudly when the format changes', () => {
    expect(() => parseQuestlogTimers({ result: { data: [{ id: 'x' }] } })).toThrow(FeedFormatError);
    expect(() => parseQuestlogTimers({ data: [] })).toThrow(FeedFormatError);
  });
});

describe('mergeReading', () => {
  const reading = {
    questlogId: 111021,
    alive: false,
    respawnAt: at('2026-10-25T12:16:45Z'),
    seenAt: at('2026-10-25T06:36:15Z'),
  };
  const manual: BossTimer = {
    bossKey: 'gartua',
    alive: false,
    respawnAt: at('2026-10-25T12:30:00Z'),
    seenAt: at('2026-10-25T06:00:00Z'),
    source: 'manual',
    overrideBy: 'officer',
    updatedAt: at('2026-10-25T06:00:00Z'),
  };

  it('stores a fresh reading', () => {
    expect(mergeReading('gartua', undefined, reading, now)).toMatchObject({
      source: 'questlog',
      respawnAt: reading.respawnAt,
    });
  });

  it('keeps a manual entry until its respawn passes', () => {
    expect(mergeReading('gartua', manual, reading, now)).toBeNull();
    expect(mergeReading('gartua', manual, reading, at('2026-10-25T12:31:00Z'))).toMatchObject({
      source: 'questlog',
    });
  });

  it('does nothing when the reading did not change', () => {
    const stored = mergeReading('gartua', undefined, reading, now)!;
    expect(mergeReading('gartua', stored, reading, now)).toBeNull();
  });
});

describe('healthProblem / canWarn', () => {
  const base = {
    failingSince: null,
    formatError: false,
    oldestSeenAt: null,
    staleAfterHours: 6,
    now,
  };

  it('reports a feed failing for more than 15 minutes', () => {
    expect(healthProblem({ ...base, failingSince: at('2026-10-25T06:30:00Z') })).toBeNull();
    expect(healthProblem({ ...base, failingSince: at('2026-10-25T06:20:00Z') })).toBe('down');
  });

  it('reports a format change right away', () => {
    expect(healthProblem({ ...base, formatError: true })).toBe('format');
  });

  it('reports readings older than staleAfterHours', () => {
    expect(healthProblem({ ...base, oldestSeenAt: at('2026-10-25T01:00:00Z') })).toBeNull();
    expect(healthProblem({ ...base, oldestSeenAt: at('2026-10-24T23:00:00Z') })).toBe('stale');
  });

  it('warns at most every 6 hours', () => {
    expect(canWarn(null, now)).toBe(true);
    expect(canWarn(at('2026-10-25T01:00:00Z'), now)).toBe(false);
    expect(canWarn(at('2026-10-25T00:40:00Z'), now)).toBe(true);
  });
});

describe('parseBossTime', () => {
  // 03:40 in São Paulo.
  it.each([
    ['09:16', '2026-10-25T12:16:00.000Z'],
    ['9h16', '2026-10-25T12:16:00.000Z'],
    ['02:00', '2026-10-26T05:00:00.000Z'], // already passed today → tomorrow
    ['em 5h44m', '2026-10-25T12:24:00.000Z'],
    ['5h', '2026-10-25T11:40:00.000Z'],
    ['44m', '2026-10-25T07:24:00.000Z'],
    ['44min', '2026-10-25T07:24:00.000Z'],
  ])('%s → %s', (input, expected) => {
    expect(parseBossTime(input, now, 'America/Sao_Paulo')?.toISOString()).toBe(expected);
  });

  it.each(['amanhã', '25:00', '0m', 'logo'])('rejects %s', (input) => {
    expect(parseBossTime(input, now, 'America/Sao_Paulo')).toBeNull();
  });
});
