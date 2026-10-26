import { describe, expect, it } from 'vitest';
import { normalizeGameName, registrationNickname, rolesWithClass } from './registration.js';

describe('registration', () => {
  it('builds the nickname from the class emoji and the game name', () => {
    expect(registrationNickname('⚔️', normalizeGameName('  Padrinho   Jr '))).toBe(
      '⚔️ Padrinho Jr',
    );
  });
});

describe('rolesWithClass', () => {
  const classes = ['assassin', 'cleric', 'mage'];

  it('keeps the class once when the member already has it (registering again)', () => {
    expect(rolesWithClass(['soldier', 'assassin'], 'assassin', classes)).toEqual([
      'soldier',
      'assassin',
    ]);
  });

  it('swaps another class for the chosen one and keeps other roles', () => {
    expect(rolesWithClass(['soldier', 'cleric', 'mage'], 'assassin', classes)).toEqual([
      'soldier',
      'assassin',
    ]);
  });
});
