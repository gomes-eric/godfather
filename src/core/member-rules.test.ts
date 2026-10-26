import { describe, expect, it } from 'vitest';
import {
  checkModerationTarget,
  decideDemotion,
  decidePartner,
  decidePromotion,
  rolesForPartner,
  rolesForTier,
} from './member-rules.js';

const base = {
  actorId: 'actor',
  targetId: 'target',
  targetIsBot: false,
  targetIsOwner: false,
  officerCount: 0,
  maxOfficers: 4,
};

describe('decidePromotion', () => {
  it('walks Visitante → Soldado (officer) → Oficial (commander)', () => {
    expect(decidePromotion({ ...base, actorTier: 'officer', targetTier: 'visitor' })).toEqual({
      ok: true,
      to: 'soldier',
    });
    expect(decidePromotion({ ...base, actorTier: 'commander', targetTier: 'soldier' })).toEqual({
      ok: true,
      to: 'officer',
    });
  });

  it('does not let an officer create another officer', () => {
    expect(decidePromotion({ ...base, actorTier: 'officer', targetTier: 'soldier' })).toEqual({
      ok: false,
      refusal: 'cannotManageTier',
    });
  });

  it('never creates a second commander', () => {
    expect(decidePromotion({ ...base, actorTier: 'commander', targetTier: 'officer' })).toEqual({
      ok: false,
      refusal: 'cannotManageTier',
    });
  });

  it('enforces the officer limit from server.yaml', () => {
    expect(
      decidePromotion({ ...base, actorTier: 'commander', targetTier: 'soldier', officerCount: 4 }),
    ).toEqual({ ok: false, refusal: 'officerLimit' });
  });

  it('accepts an explicit rank but only upwards', () => {
    expect(
      decidePromotion({ ...base, actorTier: 'commander', targetTier: 'visitor', rank: 'officer' }),
    ).toEqual({ ok: true, to: 'officer' });
    expect(
      decidePromotion({ ...base, actorTier: 'commander', targetTier: 'soldier', rank: 'visitor' }),
    ).toEqual({ ok: false, refusal: 'notHigher' });
  });

  it('refuses bots, the owner and yourself', () => {
    const actorTier = 'commander' as const;
    const targetTier = 'visitor' as const;
    expect(decidePromotion({ ...base, actorTier, targetTier, targetIsBot: true })).toMatchObject({
      refusal: 'targetIsBot',
    });
    expect(decidePromotion({ ...base, actorTier, targetTier, targetIsOwner: true })).toMatchObject({
      refusal: 'targetIsOwner',
    });
    expect(decidePromotion({ ...base, actorTier, targetTier, targetId: 'actor' })).toMatchObject({
      refusal: 'targetIsSelf',
    });
  });
});

describe('decideDemotion', () => {
  it('steps down one tier by default', () => {
    expect(decideDemotion({ ...base, actorTier: 'officer', targetTier: 'soldier' })).toEqual({
      ok: true,
      to: 'visitor',
    });
  });

  it('does not let an officer demote another officer', () => {
    expect(decideDemotion({ ...base, actorTier: 'officer', targetTier: 'officer' })).toEqual({
      ok: false,
      refusal: 'cannotManageTier',
    });
  });

  it('refuses to demote a visitor', () => {
    expect(decideDemotion({ ...base, actorTier: 'commander', targetTier: 'visitor' })).toEqual({
      ok: false,
      refusal: 'alreadyBottom',
    });
  });
});

describe('checkModerationTarget', () => {
  const input = { actorId: 'a', targetId: 't', targetIsBot: false, targetIsOwner: false };

  it('lets officers moderate soldiers and visitors only', () => {
    expect(checkModerationTarget({ ...input, actorTier: 'officer', targetTier: 'soldier' })).toBe(
      null,
    );
    expect(checkModerationTarget({ ...input, actorTier: 'officer', targetTier: 'officer' })).toBe(
      'targetTooHigh',
    );
  });

  it('protects the owner even from the commander', () => {
    expect(
      checkModerationTarget({
        ...input,
        actorTier: 'commander',
        targetTier: 'commander',
        targetIsOwner: true,
      }),
    ).toBe('targetIsOwner');
  });
});

describe('rolesForTier', () => {
  const tierRoles = { visitor: 'v', soldier: 's', officer: 'o' };

  it('swaps the tier role and keeps class roles', () => {
    expect(rolesForTier(['v', 'class-cleric'], 'soldier', tierRoles)).toEqual([
      'class-cleric',
      's',
    ]);
  });

  it('gives Visitante back on demotion to visitor', () => {
    expect(rolesForTier(['s', 'class-cleric'], 'visitor', tierRoles)).toEqual([
      'class-cleric',
      'v',
    ]);
  });
});

describe('decidePartner', () => {
  const base = {
    actorId: 'officer',
    targetId: 'friend',
    targetIsBot: false,
    targetIsOwner: false,
    targetTier: 'visitor' as const,
    isPartner: false,
    remove: false,
  };

  it('makes a Visitante a Parceiro and takes it back', () => {
    expect(decidePartner(base)).toBeNull();
    expect(decidePartner({ ...base, isPartner: true, remove: true })).toBeNull();
  });

  it('refuses legion members, repeats, bots, the owner and oneself', () => {
    expect(decidePartner({ ...base, targetTier: 'soldier' })).toBe('inLegion');
    expect(decidePartner({ ...base, isPartner: true })).toBe('alreadyPartner');
    expect(decidePartner({ ...base, remove: true })).toBe('notPartner');
    expect(decidePartner({ ...base, targetIsBot: true })).toBe('targetIsBot');
    expect(decidePartner({ ...base, targetIsOwner: true })).toBe('targetIsOwner');
    expect(decidePartner({ ...base, targetId: 'officer' })).toBe('targetIsSelf');
  });
});

describe('rolesForPartner', () => {
  it('swaps Visitante for Parceiro and back, keeping other roles', () => {
    expect(rolesForPartner(['visitor', 'class'], 'partner', 'visitor', false)).toEqual([
      'class',
      'partner',
    ]);
    expect(rolesForPartner(['partner', 'class'], 'partner', 'visitor', true)).toEqual([
      'class',
      'visitor',
    ]);
  });
});

describe('the server owner', () => {
  const input = {
    actorTier: 'commander' as const,
    actorId: 'owner',
    targetId: 'friend',
    targetTier: 'officer' as const,
    targetIsBot: false,
    targetIsOwner: false,
    officerCount: 0,
  };

  it('makes and unmakes Comandantes; a Comandante cannot', () => {
    expect(decidePromotion({ ...input, actorIsOwner: true, rank: 'commander' })).toEqual({
      ok: true,
      to: 'commander',
    });
    expect(decidePromotion({ ...input, rank: 'commander' })).toEqual({
      ok: false,
      refusal: 'cannotManageTier',
    });
    expect(
      decideDemotion({ ...input, actorIsOwner: true, targetTier: 'commander', rank: 'officer' }),
    ).toEqual({ ok: true, to: 'officer' });
  });
});
