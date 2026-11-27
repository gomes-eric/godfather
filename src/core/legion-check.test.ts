import { describe, expect, it } from 'vitest';
import {
  characterChanges,
  checkDue,
  CHECK_EVERY_MS,
  legionTransition,
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
    restrictedBy?: 'check' | 'manual',
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
    expect(go(restricted, 'Outra', 'M4F1A', 'manual')).toBeNull();
  });
});
