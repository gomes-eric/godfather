import { describe, expect, it } from 'vitest';
import {
  characterChanges,
  checkDue,
  CHECK_EVERY_MS,
  legionTransition,
  legionToStore,
  memberVerdict,
  batchVerdict,
  reviewFor,
  RANKING_SIZE,
  rankingLines,
} from './legion-check.js';

describe('characterChanges', () => {
  const before = { name: 'Padrinho', classKey: 'class-cleric', legion: 'M4F1A' };

  it('sees a character leaving the legion, renamed and with a new class', () => {
    expect(
      characterChanges(
        before,
        { name: 'Padrinho2', classKey: 'class-mage', legion: 'Outra' },
        'm4f1a',
      ),
    ).toEqual({
      renamed: { from: 'Padrinho', to: 'Padrinho2' },
      classChanged: { from: 'class-cleric', to: 'class-mage' },
      leftLegion: true,
      joinedLegion: false,
    });
  });

  it('sees a character joining, and nothing when nothing changed', () => {
    expect(characterChanges({ ...before, legion: '' }, before, 'M4F1A').joinedLegion).toBe(true);
    expect(characterChanges(before, before, 'M4F1A')).toEqual({
      renamed: null,
      classChanged: null,
      leftLegion: false,
      joinedLegion: false,
    });
  });
});

describe('checkDue', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  it('is due when a registration was never checked or is older than the interval', () => {
    expect(checkDue([null], now)).toBe(true);
    expect(checkDue([new Date(now.getTime() - CHECK_EVERY_MS)], now)).toBe(true);
    expect(checkDue([new Date(now.getTime() - 60_000)], now)).toBe(false);
    expect(checkDue([], now)).toBe(false);
  });
});

describe('rankingLines', () => {
  it('orders by combat power with medals for the top three', () => {
    const lines = rankingLines([
      { name: 'B', classEmoji: '🔥', combatPower: 100, itemLevel: 2000 },
      { name: 'A', classEmoji: '✨', combatPower: 143232, itemLevel: 2656 },
      { name: 'C', classEmoji: '🗡️', combatPower: null, itemLevel: null },
      { name: 'D', classEmoji: '🛡️', combatPower: 50, itemLevel: 1900 },
    ]);
    expect(lines[0]).toBe('🥇 ✨ **A** · ⚔️ 143.232 · 🎚️ 2.656');
    expect(lines[1]!.startsWith('🥈 🔥 **B**')).toBe(true);
    expect(lines[3]).toBe('` 4.` 🗡️ **C** · ⚔️ — · 🎚️ —');
  });

  it('keeps only the top 10', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({
      name: `M${i}`,
      classEmoji: '🎮',
      combatPower: i * 1000,
      itemLevel: 1000,
    }));
    const lines = rankingLines(rows);
    expect(lines).toHaveLength(RANKING_SIZE);
    expect(lines[0]).toContain('**M13**');
    expect(lines.at(-1)).toContain('**M4**');
  });
});

describe('legionTransition', () => {
  const alliances = [{ key: 'ally-noxus', legion: 'Noxus' }];
  const soldier = { kind: 'tier', tier: 'soldier' } as const;
  const go = (
    standing: Parameters<typeof legionTransition>[0]['standing'],
    before: string,
    now: string,
    restrictedBy?: 'check' | 'officer',
  ) => legionTransition({ standing, before, now, legion: 'M4F1A', alliances, restrictedBy });

  it('restricts a Soldado who left, or makes them Aliado of an allied legion', () => {
    expect(go(soldier, 'M4F1A', 'Outra')).toMatchObject({
      to: { kind: 'restricted' },
      review: true,
      departure: true,
    });
    expect(go(soldier, 'M4F1A', 'noxus')).toMatchObject({
      to: { kind: 'ally', allianceKey: 'ally-noxus' },
    });
    expect(go(soldier, 'M4F1A', 'M4F1A')).toBeNull();
    expect(go(soldier, '', '')).toBeNull();
  });

  it('only reports an Oficial who left', () => {
    expect(go({ kind: 'tier', tier: 'officer' }, 'M4F1A', '')).toMatchObject({
      kind: 'reportOnly',
      review: true,
    });
  });

  it('follows an Aliado who left the allied legion', () => {
    const ally = { kind: 'ally', allianceKey: 'ally-noxus' } as const;
    expect(go(ally, 'Noxus', 'Outra')).toMatchObject({ to: { kind: 'restricted' }, review: true });
    expect(go(ally, 'Noxus', 'M4F1A')).toMatchObject({
      to: { kind: 'tier', tier: 'soldier' },
      review: false,
      departure: false,
    });
    expect(go(ally, 'Noxus', 'Noxus')).toBeNull();
  });

  it("lifts only the check's own restrictions", () => {
    const restricted = { kind: 'restricted' } as const;
    expect(go(restricted, 'Outra', 'M4F1A', 'check')).toMatchObject({
      to: { kind: 'tier', tier: 'soldier' },
      why: 'returned',
    });
    expect(go(restricted, 'Outra', 'Noxus', 'check')).toMatchObject({
      to: { kind: 'ally', allianceKey: 'ally-noxus' },
    });
    expect(go(restricted, 'Outra', 'M4F1A', 'officer')).toBeNull();
  });
});

describe('memberVerdict and the batch', () => {
  const alliances = [{ key: 'ally-noxus', legion: 'Noxus' }];
  const soldier = { kind: 'tier', tier: 'soldier' } as const;
  const before = { name: 'Padrinho', classKey: 'class-cleric', legion: 'M4F1A' };
  const verdict = (
    now: Partial<typeof before>,
    checkedAt: Date | null = new Date('2026-11-01T00:00:00Z'),
  ) =>
    memberVerdict({
      before: { ...before, checkedAt },
      now: { ...before, ...now },
      legion: 'M4F1A',
      alliances,
      standing: soldier,
      restrictedBy: undefined,
    });

  it('says what changed and what to apply', () => {
    const v = verdict({ name: 'Padrinho2', classKey: 'class-sorcerer' });
    expect(v.events).toEqual([
      { kind: 'renamed', from: 'Padrinho', to: 'Padrinho2' },
      { kind: 'classChanged', from: 'class-cleric', to: 'class-sorcerer' },
    ]);
    expect(v.sync).toEqual({ name: 'Padrinho2', classKey: 'class-sorcerer' });
    expect(v.transition).toBeNull();
  });

  it('treats the first check of an old registration as the baseline: no moves, no legion reports', () => {
    const v = verdict({ legion: 'Outra' }, null);
    expect(v.transition).toBeNull();
    expect(v.events).toEqual([]);
  });

  it('holds back every move when more than 3 leave, keeping the old legion stored', () => {
    const left = verdict({ legion: 'Outra' });
    const batch = batchVerdict([left, left, left, left]);
    expect(batch).toEqual({ departures: 4, holdBack: true });
    expect(legionToStore(left, true)).toBe('M4F1A');
    expect(legionToStore(left, false)).toBe('Outra');
    expect(batchVerdict([left, left, left]).holdBack).toBe(false);
  });

  it('asks for a review with the previous standing, typed', () => {
    const toAlly = verdict({ legion: 'Noxus' }).transition!;
    expect(reviewFor(toAlly, soldier)).toEqual({
      kind: 'ally',
      allianceKey: 'ally-noxus',
      previous: soldier,
    });
    const left = verdict({ legion: 'Outra' }).transition!;
    expect(reviewFor(left, soldier)).toEqual({
      kind: 'restricted',
      allianceKey: null,
      previous: soldier,
    });
  });
});
