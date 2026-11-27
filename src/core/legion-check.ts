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
  restrictedBy: 'check' | 'officer' | 'transfer' | undefined;
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

/** What the check saw for one character, before anything is said or changed. */
export type CheckEvent =
  | { kind: 'renamed'; from: string; to: string }
  | { kind: 'classChanged'; from: string; to: string }
  | { kind: 'left'; now: string }
  | { kind: 'joined' };

export interface MemberVerdict {
  events: CheckEvent[];
  /** The character's new name or class, to apply to the member. */
  sync: { name: string; classKey: string } | null;
  transition: Transition | null;
  /** What to store as seen now. */
  now: CharacterState;
  /** The legion stored at the last check, kept when a move is held back. */
  legionBefore: string;
}

/**
 * Everything the check decides for one member: what changed, what to apply, and how their
 * standing moves. The first check of an old registration (no checkedAt) only sets the baseline.
 */
export function memberVerdict(input: {
  before: CharacterState & { checkedAt: Date | null };
  now: CharacterState;
  legion: string;
  alliances: readonly Alliance[];
  standing: Standing;
  restrictedBy: 'check' | 'officer' | 'transfer' | undefined;
}): MemberVerdict {
  const { before, now, legion } = input;
  const changes = characterChanges(before, now, legion);
  const baseline = before.checkedAt === null;
  const transition = baseline
    ? null
    : legionTransition({
        standing: input.standing,
        before: before.legion,
        now: now.legion,
        legion,
        alliances: input.alliances,
        restrictedBy: input.restrictedBy,
      });
  const events: CheckEvent[] = [];
  if (changes.renamed) events.push({ kind: 'renamed', ...changes.renamed });
  if (changes.classChanged) events.push({ kind: 'classChanged', ...changes.classChanged });
  if (!baseline && !transition) {
    if (changes.leftLegion) events.push({ kind: 'left', now: now.legion });
    if (changes.joinedLegion) events.push({ kind: 'joined' });
  }
  return {
    events,
    sync:
      changes.renamed || changes.classChanged ? { name: now.name, classKey: now.classKey } : null,
    transition,
    now,
    legionBefore: before.legion,
  };
}

/** The whole check's departures, and whether they look like a site problem (move nobody). */
export function batchVerdict(verdicts: readonly Pick<MemberVerdict, 'transition'>[]): {
  departures: number;
  holdBack: boolean;
} {
  const departures = verdicts.filter((v) => v.transition?.departure).length;
  return { departures, holdBack: !departuresLookTrustworthy(departures) };
}

/** A held-back move keeps the old legion stored, so tomorrow's check sees the change again. */
export function legionToStore(verdict: MemberVerdict, holdBack: boolean): string {
  return verdict.transition && holdBack ? verdict.legionBefore : verdict.now.legion;
}

/** The review the officers get for a move, or null when it needs none. */
export function reviewFor(
  transition: Transition,
  from: Standing,
): { kind: 'ally' | 'restricted'; allianceKey: string | null; previous: Standing } | null {
  if (!transition.review) return null;
  const to = transition.kind === 'move' ? transition.to : null;
  return to?.kind === 'ally'
    ? { kind: 'ally', allianceKey: to.allianceKey, previous: from }
    : { kind: 'restricted', allianceKey: null, previous: from };
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
