import { describe, expect, it } from 'vitest';
import {
  checkGameName,
  normalizeGameName,
  registrationNickname,
  rolesWithClass,
  stripClassEmoji,
} from './registration.js';

describe('registration', () => {
  it('builds the nickname from the class emoji and the game name', () => {
    expect(registrationNickname('⚔️', normalizeGameName('  Padrinho   Jr '))).toBe(
      '⚔️ Padrinho Jr',
    );
  });

  it('accepts accented names and refuses empty, too long or odd ones', () => {
    expect(checkGameName('Aráu', '⚔️')).toBeNull();
    expect(checkGameName("D'Artagnan-2", '🏹')).toBeNull();
    expect(checkGameName('', '⚔️')).toBe('empty');
    expect(checkGameName('a'.repeat(30), '⚔️')).toBe('tooLong');
    expect(checkGameName('<@123>', '⚔️')).toBe('invalid');
    expect(checkGameName('Nome 🔥', '⚔️')).toBe('invalid');
  });

  it('strips a class emoji the nickname already has', () => {
    expect(stripClassEmoji('⚔️ Padrinho', ['🛡️', '⚔️'])).toBe('Padrinho');
    expect(stripClassEmoji('Padrinho', ['⚔️'])).toBe('Padrinho');
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
