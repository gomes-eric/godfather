import { findAlliance, type Alliance } from './alliances.js';
import { sameLegion } from './game-character.js';
import { allyOf, PARTNER, RESTRICTED, SOLDIER, type Standing } from './standing.js';

export const APPLICATION_KINDS = ['member', 'ally', 'partner', 'restricted'] as const;
export type ApplicationKind = (typeof APPLICATION_KINDS)[number];

export type ApplicationOrigin = 'form' | 'check';

export const FORM_KINDS = ['member', 'ally', 'partner'] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export type FormRefusal = 'nameRequired' | 'noLegionForAlly';
export type KindRefusal = 'restrictedOnlyReviews' | 'noCharacterForKind' | 'noLegionForKind';

export interface ApplicationPlan {
  kind: ApplicationKind;
  allianceLegion: string | null;
  autoApprove: boolean;
}

export function kindsFor(origin: ApplicationOrigin): readonly ApplicationKind[] {
  return origin === 'check' ? APPLICATION_KINDS : FORM_KINDS;
}

export function isNewAlliance(
  kind: ApplicationKind,
  allianceLegion: string | null,
  alliances: readonly Alliance[],
): boolean {
  return kind === 'ally' && !findAlliance(alliances, allianceLegion ?? '');
}

function allianceLegionFor(legion: string, alliances: readonly Alliance[]): string {
  return findAlliance(alliances, legion)?.legion ?? legion;
}

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
