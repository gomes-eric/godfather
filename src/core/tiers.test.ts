import { describe, expect, it } from 'vitest';
import { resolveTier, tierAtLeast } from './tiers.js';

const roles = { commander: 'r-cmd', officer: 'r-off', soldier: 'r-sol' };

describe('resolveTier', () => {
  it('treats the server owner as commander even without roles', () => {
    expect(resolveTier({ roleIds: [], isOwner: true }, roles)).toBe('commander');
  });

  it('picks the highest tier when a member has several tier roles', () => {
    expect(resolveTier({ roleIds: ['r-sol', 'r-off'], isOwner: false }, roles)).toBe('officer');
  });

  it('falls back to visitor without any tier role', () => {
    expect(resolveTier({ roleIds: ['class-cleric'], isOwner: false }, roles)).toBe('visitor');
  });

  it('ignores tiers whose role does not exist yet', () => {
    expect(resolveTier({ roleIds: ['r-sol'], isOwner: false }, { soldier: 'r-sol' })).toBe(
      'soldier',
    );
    expect(resolveTier({ roleIds: ['anything'], isOwner: false }, {})).toBe('visitor');
  });
});

describe('tierAtLeast', () => {
  it('compares by rank', () => {
    expect(tierAtLeast('commander', 'officer')).toBe(true);
    expect(tierAtLeast('officer', 'officer')).toBe(true);
    expect(tierAtLeast('soldier', 'officer')).toBe(false);
  });
});
