import { describe, expect, it } from 'vitest';
import { allianceKey, findAlliance } from './alliances.js';

describe('alliances', () => {
  it('finds an alliance ignoring case and accents', () => {
    expect(findAlliance([{ key: 'ally-noxus', legion: 'Nóxus' }], 'NOXUS')?.key).toBe('ally-noxus');
    expect(findAlliance([], 'Noxus')).toBeUndefined();
  });

  it('makes a unique kebab-case key', () => {
    expect(allianceKey('Os Lobos da Noite', [])).toBe('ally-os-lobos-da-noite');
    expect(allianceKey('Ñoxus!', ['ally-noxus'])).toBe('ally-noxus-2');
    expect(allianceKey('★★', [])).toBe('ally-legion');
  });
});
