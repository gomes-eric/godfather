import { findAlliance, type Alliance } from './alliances.js';
import { sameLegion } from './game-character.js';
import { allyOf, PARTNER, RESTRICTED, SOLDIER, type Standing } from './standing.js';

// Pure rules for a recruitment application: what the applicant picked, what approving it does,
// and when the bot approves it on its own.

export type ApplicationKind = 'member' | 'ally' | 'partner' | 'restricted';

/** What the applicant can pick in the form; Restrito only comes from the daily check. */
export const FORM_KINDS = ['member', 'ally', 'partner'] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export type FormRefusal = 'nameRequired' | 'noLegionForAlly';

export interface ApplicationPlan {
  kind: ApplicationKind;
  /** The ally's legion as the official site shows it. */
  allianceLegion: string | null;
  /** Aliança with a legion that is not an alliance yet: only a Comandante approves it. */
  newAlliance: boolean;
  /** Membro whose character is in the legion, and nobody else has it: approved right away. */
  autoApprove: boolean;
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
  /** Restrito by an officer (or a character transfer): only an officer lets them back in. */
  restrictedByOfficer?: boolean;
}): ApplicationPlan | { refusal: FormRefusal } {
  const { character, legion } = input;
  if (input.picked === 'partner') {
    return { kind: 'partner', allianceLegion: null, newAlliance: false, autoApprove: false };
  }
  if (!character) return { refusal: 'nameRequired' };

  const inLegion = sameLegion(character.legion, legion);
  if (input.picked === 'ally' && !inLegion) {
    if (!character.legion) return { refusal: 'noLegionForAlly' };
    const known = findAlliance(input.alliances, character.legion);
    return {
      kind: 'ally',
      allianceLegion: known?.legion ?? character.legion,
      newAlliance: known === undefined,
      autoApprove: false,
    };
  }
  return {
    kind: 'member',
    allianceLegion: null,
    newAlliance: false,
    autoApprove: inLegion && !input.takenBySomeoneElse && !input.restrictedByOfficer,
  };
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
