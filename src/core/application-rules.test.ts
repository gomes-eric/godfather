import { describe, expect, it } from 'vitest';
import { approvedStanding, planApplication } from './application-rules.js';

const alliances = [{ key: 'ally-noxus', legion: 'Noxus' }];
const plan = (picked: 'member' | 'ally' | 'partner', legion: string | null, taken = false) =>
  planApplication({
    picked,
    character: legion === null ? null : { legion },
    legion: 'M4F1A',
    alliances,
    takenBySomeoneElse: taken,
  });

describe('planApplication', () => {
  it('approves a Membro already in the legion on its own, unless someone else has the character', () => {
    expect(plan('member', 'm4f1a')).toMatchObject({ kind: 'member', autoApprove: true });
    expect(plan('member', 'M4F1A', true)).toMatchObject({ kind: 'member', autoApprove: false });
    expect(plan('member', 'Outra')).toMatchObject({ kind: 'member', autoApprove: false });
  });

  it('needs a character for Membro and Aliança, not for Parceiro', () => {
    expect(plan('member', null)).toEqual({ refusal: 'nameRequired' });
    expect(plan('ally', null)).toEqual({ refusal: 'nameRequired' });
    expect(plan('partner', null)).toMatchObject({ kind: 'partner', autoApprove: false });
  });

  it('checks an Aliança against the alliances', () => {
    expect(plan('ally', 'noxus')).toMatchObject({
      kind: 'ally',
      allianceLegion: 'Noxus',
      newAlliance: false,
    });
    expect(plan('ally', 'Lagta')).toMatchObject({ allianceLegion: 'Lagta', newAlliance: true });
    expect(plan('ally', '')).toEqual({ refusal: 'noLegionForAlly' });
    // Picked Aliança with a character of our own legion: a Membro, approved on its own.
    expect(plan('ally', 'M4F1A')).toMatchObject({ kind: 'member', autoApprove: true });
  });
});

describe('approvedStanding', () => {
  it('gives the standing of each type, and nothing for a legion that is not an alliance', () => {
    expect(approvedStanding('member', null, alliances)).toEqual({ kind: 'tier', tier: 'soldier' });
    expect(approvedStanding('ally', 'NOXUS', alliances)).toEqual({
      kind: 'ally',
      alliance: 'ally-noxus',
    });
    expect(approvedStanding('ally', 'Lagta', alliances)).toBeUndefined();
    expect(approvedStanding('partner', null, alliances)).toEqual({ kind: 'partner' });
  });
});
