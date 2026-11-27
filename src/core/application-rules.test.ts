import { describe, expect, it } from 'vitest';
import {
  approvedStanding,
  isNewAlliance,
  kindsFor,
  planApplication,
  resolveKind,
} from './application-rules.js';

const alliances = [{ key: 'ally-noxus', legion: 'Noxus' }];
const plan = (
  picked: 'member' | 'ally' | 'partner',
  legion: string | null,
  taken = false,
  restrictionNeedsOfficer = false,
) =>
  planApplication({
    picked,
    character: legion === null ? null : { legion },
    legion: 'M4F1A',
    alliances,
    takenBySomeoneElse: taken,
    restrictionNeedsOfficer,
  });

describe('planApplication', () => {
  it('approves a Membro already in the legion on its own, unless someone else has the character', () => {
    expect(plan('member', 'm4f1a')).toMatchObject({ kind: 'member', autoApprove: true });
    expect(plan('member', 'M4F1A', true)).toMatchObject({ kind: 'member', autoApprove: false });
    expect(plan('member', 'Outra')).toMatchObject({ kind: 'member', autoApprove: false });
    expect(plan('member', 'M4F1A', false, true)).toMatchObject({ autoApprove: false });
  });

  it('needs a character for Membro and Aliança, not for Parceiro', () => {
    expect(plan('member', null)).toEqual({ refusal: 'nameRequired' });
    expect(plan('ally', null)).toEqual({ refusal: 'nameRequired' });
    expect(plan('partner', null)).toMatchObject({ kind: 'partner', autoApprove: false });
  });

  it('checks an Aliança against the alliances', () => {
    expect(plan('ally', 'noxus')).toMatchObject({ kind: 'ally', allianceLegion: 'Noxus' });
    expect(plan('ally', 'Lagta')).toMatchObject({ kind: 'ally', allianceLegion: 'Lagta' });
    expect(isNewAlliance('ally', 'NOXUS', alliances)).toBe(false);
    expect(isNewAlliance('ally', 'Lagta', alliances)).toBe(true);
    expect(isNewAlliance('member', 'Lagta', alliances)).toBe(false);
    expect(plan('ally', '')).toEqual({ refusal: 'noLegionForAlly' });
    expect(plan('ally', 'M4F1A')).toMatchObject({ kind: 'member', autoApprove: true });
  });
});

describe('approvedStanding', () => {
  it('gives the standing of each type, and nothing for a legion that is not an alliance', () => {
    expect(approvedStanding('member', null, alliances)).toEqual({ kind: 'tier', tier: 'soldier' });
    expect(approvedStanding('ally', 'NOXUS', alliances)).toEqual({
      kind: 'ally',
      allianceKey: 'ally-noxus',
    });
    expect(approvedStanding('ally', 'Lagta', alliances)).toBeUndefined();
    expect(approvedStanding('partner', null, alliances)).toEqual({ kind: 'partner' });
  });
});

describe('kind policy', () => {
  it('offers Restrito only on the daily check reviews', () => {
    expect(kindsFor('form')).toEqual(['member', 'ally', 'partner']);
    expect(kindsFor('check')).toContain('restricted');
  });

  it('resolves Mudar: Aliança takes the character legion; a type needing a character refuses without one', () => {
    const form = { origin: 'form' as const, character: { legion: 'noxus' } };
    expect(resolveKind(form, 'ally', alliances)).toEqual({ kind: 'ally', allianceLegion: 'Noxus' });
    expect(resolveKind(form, 'partner', alliances)).toEqual({
      kind: 'partner',
      allianceLegion: null,
    });
    expect(resolveKind(form, 'restricted', alliances)).toEqual({
      refusal: 'restrictedOnlyReviews',
    });
    expect(resolveKind({ origin: 'form', character: null }, 'member', alliances)).toEqual({
      refusal: 'noCharacterForKind',
    });
    expect(resolveKind({ origin: 'check', character: { legion: '' } }, 'ally', alliances)).toEqual({
      refusal: 'noLegionForKind',
    });
  });
});
