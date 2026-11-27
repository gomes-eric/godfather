import { findAlliance, type Alliance } from './alliances.js';
import { sameLegion } from './game-character.js';
import { allyOf, RESTRICTED, SOLDIER, type Standing } from './standing.js';

export interface CharacterState {
  name: string;
  classKey: string;
  legion: string;
}

export interface CharacterChanges {
  renamed: { from: string; to: string } | null;
  classChanged: { from: string; to: string } | null;
  leftLegion: boolean;
  joinedLegion: boolean;
}

export function characterChanges(
  before: CharacterState,
  now: CharacterState,
  legion: string,
): CharacterChanges {
  const wasIn = sameLegion(before.legion, legion);
  const isIn = sameLegion(now.legion, legion);
  return {
    renamed: before.name !== now.name ? { from: before.name, to: now.name } : null,
    classChanged:
      before.classKey !== now.classKey ? { from: before.classKey, to: now.classKey } : null,
    leftLegion: wasIn && !isIn,
    joinedLegion: !wasIn && isIn,
  };
}

export const MAX_DEPARTURES = 3;

export function departuresLookTrustworthy(departures: number): boolean {
  return departures <= MAX_DEPARTURES;
}

export type Transition =
  | {
      kind: 'move';
      to: Standing;
      review: boolean;
      departure: boolean;
      why: 'leftLegion' | 'leftAlliance' | 'returned';
    }
  | { kind: 'reportOnly'; review: true; departure: true; why: 'leftLegion' };

export function legionTransition(input: {
  standing: Standing;
  before: string;
  now: string;
  legion: string;
  alliances: readonly Alliance[];
  restrictedBy: 'check' | 'manual' | 'transfer' | undefined;
}): Transition | null {
  const { standing, before, now, legion } = input;
  const nowIn = sameLegion(now, legion);
  const ally = findAlliance(input.alliances, now);
  const elsewhere = (): Standing => (ally ? allyOf(ally.key) : RESTRICTED);

  if (standing.kind === 'tier') {
    if (!sameLegion(before, legion) || nowIn) return null;
    return standing.tier === 'soldier'
      ? { kind: 'move', to: elsewhere(), review: true, departure: true, why: 'leftLegion' }
      : { kind: 'reportOnly', review: true, departure: true, why: 'leftLegion' };
  }
  if (standing.kind === 'ally') {
    const allied = input.alliances.find((a) => a.key === standing.allianceKey);
    if (!allied || !sameLegion(before, allied.legion) || sameLegion(now, allied.legion)) {
      return null;
    }
    return nowIn
      ? { kind: 'move', to: SOLDIER, review: false, departure: false, why: 'returned' }
      : { kind: 'move', to: elsewhere(), review: true, departure: true, why: 'leftAlliance' };
  }
  if (standing.kind === 'restricted' && input.restrictedBy === 'check') {
    if (nowIn)
      return { kind: 'move', to: SOLDIER, review: false, departure: false, why: 'returned' };
    if (ally)
      return {
        kind: 'move',
        to: allyOf(ally.key),
        review: false,
        departure: false,
        why: 'returned',
      };
  }
  return null;
}

export const CHECK_EVERY_MS = 23 * 60 * 60_000;

export function checkDue(checkedAt: readonly (Date | null)[], now: Date): boolean {
  return checkedAt.some((at) => !at || now.getTime() - at.getTime() >= CHECK_EVERY_MS);
}

export interface RankingRow {
  name: string;
  classEmoji: string;
  combatPower: number | null;
  itemLevel: number | null;
}

const MEDALS = ['🥇', '🥈', '🥉'];
export const RANKING_SIZE = 10;
export const formatStat = (value: number | null) =>
  value === null ? '—' : value.toLocaleString('pt-BR');

export const byCombatPower = (
  a: { combatPower: number | null },
  b: { combatPower: number | null },
) => (b.combatPower ?? -1) - (a.combatPower ?? -1);

export function topRanking<T extends RankingRow>(rows: readonly T[]): T[] {
  return [...rows].sort(byCombatPower).slice(0, RANKING_SIZE);
}

export function rankingLines(rows: readonly RankingRow[]): string[] {
  return topRanking(rows).map((row, i) => {
    const place = MEDALS[i] ?? `\`${String(i + 1).padStart(2, ' ')}.\``;
    return `${place} ${row.classEmoji} **${row.name}** · ⚔️ ${formatStat(row.combatPower)} · 🎚️ ${formatStat(row.itemLevel)}`;
  });
}
