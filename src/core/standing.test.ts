import { describe, expect, it } from 'vitest';
import {
  allyOf,
  decideStandingChange,
  decodeStanding,
  encodeStanding,
  PARTNER,
  RESTRICTED,
  rolesForStanding,
  SOLDIER,
  standingOf,
  standingTier,
  VISITOR,
  type StandingRoles,
} from './standing.js';

const roles: StandingRoles = {
  tiers: { soldier: 's', officer: 'o', commander: 'c' },
  visitor: 'v',
  partner: 'p',
  restricted: 'r',
  ally: 'a',
  alliances: { 'ally-noxus': 'nx' },
};

describe('standingOf', () => {
  it('ranks first, then ally, partner, restricted, visitor', () => {
    expect(standingOf(['s', 'p'], roles)).toEqual(SOLDIER);
    expect(standingOf(['a', 'nx', 'class'], roles)).toEqual(allyOf('ally-noxus'));
    expect(standingOf(['p'], roles)).toEqual(PARTNER);
    expect(standingOf(['r'], roles)).toEqual(RESTRICTED);
    expect(standingOf(['class'], roles)).toEqual(VISITOR);
    expect(standingOf([], roles, true)).toEqual({ kind: 'tier', tier: 'commander' });
  });

  it('an ally acts as Soldado; partner and restricted as Visitante', () => {
    expect(standingTier(allyOf('ally-noxus'))).toBe('soldier');
    expect(standingTier(PARTNER)).toBe('visitor');
    expect(standingTier(RESTRICTED)).toBe('visitor');
  });
});

describe('rolesForStanding', () => {
  it('swaps every standing role for the new one and keeps the rest', () => {
    expect(rolesForStanding(['s', 'class', 'bot'], PARTNER, roles)).toEqual(['class', 'bot', 'p']);
    expect(rolesForStanding(['p', 'class'], allyOf('ally-noxus'), roles)).toEqual([
      'class',
      'a',
      'nx',
    ]);
    expect(rolesForStanding(['a', 'nx', 'class'], RESTRICTED, roles)).toEqual(['class', 'r']);
    expect(rolesForStanding(['r'], VISITOR, roles)).toEqual(['v']);
  });

  it('is null when a needed role does not exist', () => {
    expect(rolesForStanding(['v'], allyOf('ally-lagta'), roles)).toBeNull();
    expect(rolesForStanding(['v'], RESTRICTED, { ...roles, restricted: undefined })).toBeNull();
  });
});

describe('decideStandingChange', () => {
  const base = {
    actorTier: 'officer' as const,
    actorId: 'officer',
    targetId: 'u1',
    targetIsBot: false,
    targetIsOwner: false,
  };

  it('lets an officer move a Soldado or an ally anywhere below them', () => {
    expect(decideStandingChange({ ...base, from: SOLDIER, to: PARTNER })).toBeNull();
    expect(decideStandingChange({ ...base, from: allyOf('x'), to: RESTRICTED })).toBeNull();
  });

  it('keeps the rank rule and refuses no-ops', () => {
    const officer = { kind: 'tier', tier: 'officer' } as const;
    expect(decideStandingChange({ ...base, from: officer, to: PARTNER })).toBe('cannotManageTier');
    expect(
      decideStandingChange({ ...base, actorTier: 'commander', from: officer, to: PARTNER }),
    ).toBeNull();
    expect(decideStandingChange({ ...base, from: PARTNER, to: PARTNER })).toBe('alreadyThere');
    expect(decideStandingChange({ ...base, targetId: 'officer', from: SOLDIER, to: PARTNER })).toBe(
      'targetIsSelf',
    );
  });
});

it('stores and reads back every standing', () => {
  for (const standing of [SOLDIER, PARTNER, RESTRICTED, VISITOR, allyOf('ally-noxus')]) {
    expect(decodeStanding(encodeStanding(standing))).toEqual(standing);
  }
});
