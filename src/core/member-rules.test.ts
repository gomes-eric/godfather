import { describe, expect, it } from 'vitest';
import {
  checkModerationTarget,
  decideDemotion,
  decidePromotion,
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
