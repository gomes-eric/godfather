import { sameLegion } from './game-character.js';

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
const MAX_ROWS = 50;
const num = (value: number | null) => (value === null ? '—' : value.toLocaleString('pt-BR'));

/** Ranking lines by combat power (highest first), item level alongside. */
export function rankingLines(rows: readonly RankingRow[]): string[] {
  return [...rows]
    .sort((a, b) => (b.combatPower ?? -1) - (a.combatPower ?? -1))
    .slice(0, MAX_ROWS)
    .map((row, i) => {
      const place = MEDALS[i] ?? `\`${String(i + 1).padStart(2, ' ')}.\``;
      return `${place} ${row.classEmoji} **${row.name}** · ⚔️ ${num(row.combatPower)} · 🎚️ ${num(row.itemLevel)}`;
    });
}
