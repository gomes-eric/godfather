import { describe, expect, it } from 'vitest';
import { ACTION_POLICIES, authorize, canChangeTier, type ActionName } from './permissions.js';
import { TIERS, type Tier } from './tiers.js';

describe('authorize', () => {
  it.each<[ActionName, Tier]>([
    ['member.ban', 'commander'],
    ['member.kick', 'officer'],
    ['channel.delete', 'commander'],
    ['member.restrict', 'officer'],
    ['alliance.add', 'commander'],
    ['alliance.read', 'soldier'],
    ['event.create', 'officer'],
    ['event.rsvp', 'soldier'],
    ['setup.apply', 'commander'],
    ['mcp.token.create', 'officer'],
    ['mcp.token.revoke.any', 'commander'],
    ['audit.read', 'officer'],
  ])('%s requires %s', (action, minTier) => {
    for (const tier of TIERS) {
      const expected = TIERS.indexOf(tier) >= TIERS.indexOf(minTier);
      expect(authorize(tier, action).allowed, `${tier} → ${action}`).toBe(expected);
    }
  });

  it('reports the required tier when denied', () => {
    expect(authorize('officer', 'member.ban')).toEqual({
      allowed: false,
      requiredTier: 'commander',
    });
  });

  it('never lets a visitor perform any audited action', () => {
    for (const [action, policy] of Object.entries(ACTION_POLICIES)) {
      if (policy.audited) {
        expect(authorize('visitor', action as ActionName).allowed, action).toBe(false);
      }
    }
  });
});

describe('destructive actions', () => {
  it('match the PLAN.md §5.2 matrix', () => {
    const destructive = Object.entries(ACTION_POLICIES)
      .filter(([, policy]) => policy.destructive)
      .map(([action]) => action)
      .sort();

    expect(destructive).toEqual([
      'alliance.remove',
      'channel.delete',
      'event.cancel',
      'member.ban',
      'member.demote',
      'member.kick',
      'message.purge',
      'role.delete',
      'setup.apply',
      'voice.generator.delete',
    ]);
  });

  it('are always audited', () => {
    for (const [action, policy] of Object.entries(ACTION_POLICIES)) {
      expect(policy.destructive && !policy.audited, action).toBe(false);
    }
  });
});

describe('canChangeTier', () => {
  it('lets officers promote visitors to soldier but not soldiers to officer', () => {
    expect(canChangeTier('officer', 'visitor', 'soldier')).toBe(true);
    expect(canChangeTier('officer', 'soldier', 'officer')).toBe(false);
  });

  it('lets officers demote soldiers but not other officers', () => {
    expect(canChangeTier('officer', 'soldier', 'visitor')).toBe(true);
    expect(canChangeTier('officer', 'officer', 'soldier')).toBe(false);
  });

  it('lets the commander manage officers but not create another commander', () => {
    expect(canChangeTier('commander', 'soldier', 'officer')).toBe(true);
    expect(canChangeTier('commander', 'officer', 'soldier')).toBe(true);
    expect(canChangeTier('commander', 'officer', 'commander')).toBe(false);
  });

  it('never lets someone raise a member to their own tier', () => {
    expect(canChangeTier('soldier', 'visitor', 'soldier')).toBe(false);
  });
});
