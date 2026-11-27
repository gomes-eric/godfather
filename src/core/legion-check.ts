import { findAlliance, type Alliance } from './alliances.js';
import { sameLegion } from './game-character.js';
import { allyOf, RESTRICTED, SOLDIER, type Standing } from './standing.js';

// Pure rules for the daily legion check and the #ranking board.

export interface CharacterState {
  name: string;
  classKey: string;
  legion: string;
}

export interface CharacterChanges {
  renamed: { from: string; to: string } | null;
  classChanged: { from: string; to: string } | null;
  /** Was in the legion at the last check and is not now. */
  leftLegion: boolean;
  /** Was not in the legion at the last check and is now. */
  joinedLegion: boolean;
}

/** What changed for a character between the last check and now. */
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

/** More departures than this in one check look like a site problem: nobody is moved. */
export const MAX_DEPARTURES = 3;

/** What the check does about someone's standing after reading their character. */
export interface Transition {
  /** The new standing; null when it only tells the officers (an Oficial or Comandante left). */
  to: Standing | null;
  /** Opens a review for the officers (Aprovar keeps it, Recusar puts the old standing back). */
  review: boolean;
  /** Left the legion or the alliance; counts toward MAX_DEPARTURES. */
  departure: boolean;
  why: 'leftLegion' | 'leftAlliance' | 'returned';
}

/**
 * Who the check moves, from their standing and their character's legion at the last check and
 * now:
 * - a Soldado who left the legion becomes Aliado (if the new legion is an alliance) or Restrito;
 *   an Oficial or Comandante who left is only reported;
 * - an Aliado who left the allied legion becomes Soldado (joined us), Aliado of the new alliance,
 *   or Restrito;
 * - someone the check made Restrito whose character is back in the legion or in an alliance gets
 *   Soldado or Aliado back. A restriction by an officer stays.
 * Each change away from the legion or alliance opens a review.
 */
export function legionTransition(input: {
  standing: Standing;
  before: string;
  now: string;
  legion: string;
  alliances: readonly Alliance[];
  /** Why they are Restrito, when they are: only the check's own restrictions are lifted. */
  restrictedBy: 'check' | 'manual' | 'transfer' | undefined;
}): Transition | null {
  const { standing, before, now, legion } = input;
  const nowIn = sameLegion(now, legion);
  const ally = findAlliance(input.alliances, now);
  const elsewhere = (): Standing => (ally ? allyOf(ally.key) : RESTRICTED);

  if (standing.kind === 'tier') {
    if (!sameLegion(before, legion) || nowIn) return null;
    return standing.tier === 'soldier'
      ? { to: elsewhere(), review: true, departure: true, why: 'leftLegion' }
      : { to: null, review: true, departure: true, why: 'leftLegion' };
  }
  if (standing.kind === 'ally') {
    const allied = input.alliances.find((a) => a.key === standing.alliance);
    if (!allied || !sameLegion(before, allied.legion) || sameLegion(now, allied.legion)) {
      return null;
    }
    return nowIn
      ? { to: SOLDIER, review: false, departure: false, why: 'returned' }
      : { to: elsewhere(), review: true, departure: true, why: 'leftAlliance' };
  }
  if (standing.kind === 'restricted' && input.restrictedBy === 'check') {
    if (nowIn) return { to: SOLDIER, review: false, departure: false, why: 'returned' };
    if (ally) return { to: allyOf(ally.key), review: false, departure: false, why: 'returned' };
  }
  return null;
}

/** The check runs again once the oldest registration was last checked this long ago. */
export const CHECK_EVERY_MS = 23 * 60 * 60_000;

/** Whether a check is due: some registration has never been checked or was checked too long ago. */
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
/** The board shows the top 10. */
export const RANKING_SIZE = 10;
export const formatStat = (value: number | null) =>
  value === null ? '—' : value.toLocaleString('pt-BR');

/** Highest combat power first; unknown power last. */
export const byCombatPower = (
  a: { combatPower: number | null },
  b: { combatPower: number | null },
) => (b.combatPower ?? -1) - (a.combatPower ?? -1);

/** The top of the board: highest combat power first. */
export function topRanking<T extends RankingRow>(rows: readonly T[]): T[] {
  return [...rows].sort(byCombatPower).slice(0, RANKING_SIZE);
}

/** Ranking lines by combat power (highest first), item level alongside. */
export function rankingLines(rows: readonly RankingRow[]): string[] {
  return topRanking(rows).map((row, i) => {
    const place = MEDALS[i] ?? `\`${String(i + 1).padStart(2, ' ')}.\``;
    return `${place} ${row.classEmoji} **${row.name}** · ⚔️ ${formatStat(row.combatPower)} · 🎚️ ${formatStat(row.itemLevel)}`;
  });
}
