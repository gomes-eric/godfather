import { findAlliance, type Alliance } from './alliances.js';
import { sameLegion } from './game-character.js';
import { allyOf, PARTNER, RESTRICTED, SOLDIER, type Standing } from './standing.js';

export type ApplicationKind = 'member' | 'ally' | 'partner' | 'restricted';

export const FORM_KINDS = ['member', 'ally', 'partner'] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export type FormRefusal = 'nameRequired' | 'noLegionForAlly';

export interface ApplicationPlan {
  kind: ApplicationKind;
  allianceLegion: string | null;
  newAlliance: boolean;
  autoApprove: boolean;
}

export function planApplication(input: {
  picked: FormKind;
  character: { legion: string } | null;
  legion: string;
  alliances: readonly Alliance[];
  takenBySomeoneElse: boolean;
  restrictionNeedsOfficer?: boolean;
}): ApplicationPlan | { refusal: FormRefusal } {
  const { character, legion } = input;
  if (input.picked === 'partner') {
    return { kind: 'partner', allianceLegion: null, newAlliance: false, autoApprove: false };
  }
  if (!character) return { refusal: 'nameRequired' };

  const inLegion = sameLegion(character.legion, legion);
  const asMember: ApplicationPlan = {
    kind: 'member',
    allianceLegion: null,
    newAlliance: false,
    autoApprove: inLegion && !input.takenBySomeoneElse && !input.restrictionNeedsOfficer,
  };
  if (input.picked === 'member') return asMember;

  const allyOfOwnLegion = inLegion;
  if (allyOfOwnLegion) return asMember;
  if (!character.legion) return { refusal: 'noLegionForAlly' };
  const known = findAlliance(input.alliances, character.legion);
  return {
    kind: 'ally',
    allianceLegion: known?.legion ?? character.legion,
    newAlliance: known === undefined,
    autoApprove: false,
  };
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
