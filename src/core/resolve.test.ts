import { describe, expect, it } from 'vitest';
import { resolveCandidate, type Candidate } from './resolve.js';

const members: Candidate[] = [
  { id: '1563808696885313608', names: ['padrinho', 'Padrinho'], label: 'Padrinho (@padrinho)' },
  { id: '907337576367673364', names: ['djndroficial', 'DJNDR'], label: 'DJNDR (@djndroficial)' },
  { id: '111111111111111111', names: ['tireurzin', '👑 Mouzz 👑'], label: '👑 Mouzz 👑' },
  { id: '222222222222222222', names: ['micaelddias', 'micaeldias'], label: 'micaeldias' },
];

describe('resolveCandidate', () => {
  it('accepts mentions and ids', () => {
    expect(resolveCandidate('<@1563808696885313608>', members)).toEqual({
      ok: true,
      id: '1563808696885313608',
    });
    expect(resolveCandidate('<@!907337576367673364>', members)).toMatchObject({ ok: true });
    expect(resolveCandidate('111111111111111111', members)).toMatchObject({ ok: true });
  });

  it('matches names ignoring case, accents and a leading @ or #', () => {
    expect(resolveCandidate('@PADRINHO', members)).toMatchObject({ id: '1563808696885313608' });
    expect(resolveCandidate('djndr', members)).toMatchObject({ id: '907337576367673364' });
  });

  it('falls back to a unique partial match', () => {
    expect(resolveCandidate('mouzz', members)).toMatchObject({ id: '111111111111111111' });
  });

  it('prefers an exact name over partial ones', () => {
    expect(resolveCandidate('micaeldias', members)).toMatchObject({ id: '222222222222222222' });
  });

  it('lists the options when a name is ambiguous', () => {
    const channels: Candidate[] = [
      { id: '1'.repeat(18), names: ['abismo'], label: '#abismo' },
      { id: '2'.repeat(18), names: ['Abismo'], label: '🔊 Abismo' },
    ];
    expect(resolveCandidate('#abismo', channels)).toEqual({
      ok: false,
      reason: 'ambiguous',
      options: ['#abismo', '🔊 Abismo'],
    });
  });

  it('reports nothing found', () => {
    expect(resolveCandidate('fulano', members)).toEqual({ ok: false, reason: 'none', options: [] });
    expect(resolveCandidate('999999999999999999', members)).toMatchObject({ reason: 'none' });
  });
});
