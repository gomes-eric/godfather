import { findAlliance, type Alliance } from './alliances.js';
import { sameLegion } from './game-character.js';
import { allyOf, PARTNER, RESTRICTED, SOLDIER, type Standing } from './standing.js';

/** What approving an application gives: Membro (Soldado), Aliança, Parceiro, or Restrito. */
export const APPLICATION_KINDS = ['member', 'ally', 'partner', 'restricted'] as const;
export type ApplicationKind = (typeof APPLICATION_KINDS)[number];

/** Where an application came from: the form, or a review the daily check opened. */
export type ApplicationOrigin = 'form' | 'check';

/** What the applicant can pick in the form; Restrito only comes from the daily check. */
export const FORM_KINDS = ['member', 'ally', 'partner'] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export type FormRefusal = 'nameRequired' | 'noLegionForAlly';
export type KindRefusal = 'restrictedOnlyReviews' | 'noCharacterForKind' | 'noLegionForKind';

export interface ApplicationPlan {
  kind: ApplicationKind;
  allianceLegion: string | null;
  autoApprove: boolean;
}

/** The kinds an officer may switch an application to with Mudar. */
export function kindsFor(origin: ApplicationOrigin): readonly ApplicationKind[] {
  return origin === 'check' ? APPLICATION_KINDS : FORM_KINDS;
}

/** An Aliança whose legion is not an alliance yet: only a Comandante approves it. */
export function isNewAlliance(
  kind: ApplicationKind,
  allianceLegion: string | null,
  alliances: readonly Alliance[],
): boolean {
  return kind === 'ally' && !findAlliance(alliances, allianceLegion ?? '');
}

/** The ally's legion as the alliances list spells it, or as the game does for a new one. */
function allianceLegionFor(legion: string, alliances: readonly Alliance[]): string {
  return findAlliance(alliances, legion)?.legion ?? legion;
}

/**
 * Turns the form into what approving it will do:
 * - Membro needs a character; one already in the legion is approved on its own.
 * - Aliança needs a character in a legion: ours makes it a Membro; another one is checked against
 *   the alliances (a new one is a request only a Comandante approves).
 * - Parceiro may leave the character out.
 * A character registered by someone else, or someone an officer restricted, is never approved on
 * its own.
 */
export function planApplication(input: {
  picked: FormKind;
  character: { legion: string } | null;
  legion: string;
  alliances: readonly Alliance[];
  takenBySomeoneElse: boolean;
  restrictionNeedsOfficer: boolean;
}): ApplicationPlan | { refusal: FormRefusal } {
  const { character, legion } = input;
  if (input.picked === 'partner') {
    return { kind: 'partner', allianceLegion: null, autoApprove: false };
  }
  if (!character) return { refusal: 'nameRequired' };

  const inLegion = sameLegion(character.legion, legion);
  const asMember: ApplicationPlan = {
    kind: 'member',
    allianceLegion: null,
    autoApprove: inLegion && !input.takenBySomeoneElse && !input.restrictionNeedsOfficer,
  };
  if (input.picked === 'member') return asMember;

  const allyOfOwnLegion = inLegion;
  if (allyOfOwnLegion) return asMember;
  if (!character.legion) return { refusal: 'noLegionForAlly' };
  return {
    kind: 'ally',
    allianceLegion: allianceLegionFor(character.legion, input.alliances),
    autoApprove: false,
  };
}

/** Mudar: the kind and alliance legion an application gets, or why it can't be that kind. */
export function resolveKind(
  application: { origin: ApplicationOrigin; character: { legion: string } | null },
  kind: ApplicationKind,
  alliances: readonly Alliance[],
): { kind: ApplicationKind; allianceLegion: string | null } | { refusal: KindRefusal } {
  if (!kindsFor(application.origin).includes(kind)) return { refusal: 'restrictedOnlyReviews' };
  const { character } = application;
  if ((kind === 'member' || kind === 'ally') && !character) {
    return { refusal: 'noCharacterForKind' };
  }
  if (kind !== 'ally') return { kind, allianceLegion: null };
  if (!character?.legion) return { refusal: 'noLegionForKind' };
  return { kind, allianceLegion: allianceLegionFor(character.legion, alliances) };
}

/**
 * The standing approving gives. Undefined for an Aliança whose legion is not an alliance (create
 * it first).
 */
export function approvedStanding(
  kind: ApplicationKind,
  allianceLegion: string | null,
  alliances: readonly Alliance[],
): Standing | undefined {
  switch (kind) {
    case 'member':
      return SOLDIER;
    case 'partner':
      return PARTNER;
    case 'restricted':
      return RESTRICTED;
    case 'ally': {
      const alliance = allianceLegion ? findAlliance(alliances, allianceLegion) : undefined;
      return alliance ? allyOf(alliance.key) : undefined;
    }
  }
}
