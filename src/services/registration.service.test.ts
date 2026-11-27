import { describe, expect, it } from 'vitest';
import type { Actor } from '../core/actor.js';
import { profile, registrationFixture, roleId } from './testing/roster-fixture.js';

const officer: Actor = { userId: 'officer', tier: 'officer', source: 'mcp' };
const padrinho = profile('Padrinho', 'M4F1A');

function setup(options: { siteDown?: boolean } = {}) {
  const f = registrationFixture({ padrinho }, options);
  f.members
    .add({ id: 'officer', roleIds: [roleId('officer')] })
    .add({ id: 'u1', displayName: 'Fulano', roleIds: [roleId('visitor')] })
    .add({ id: 'u2', displayName: 'Beltrano', roleIds: [roleId('soldier')] });
  return f;
}

describe('RegistrationService', () => {
  it('registers the character and makes a Visitante a Soldado in one write', async () => {
    const { registration, registrations, members } = setup();
    const outcome = await registration.register(officer, 'u1', '  padrinho ');
    expect(outcome).toMatchObject({ status: 'ok', value: expect.stringContaining('Soldado') });
    expect(members.roles('u1')).toEqual([roleId('soldier'), roleId('class-cleric')]);
    expect(members.writes).toEqual([expect.objectContaining({ nickname: '✨ Padrinho' })]);
    expect(registrations.get('u1')).toMatchObject({ name: 'Padrinho', classKey: 'class-cleric' });
  });

  it('keeps the standing of someone already in the legion', async () => {
    const { registration, members } = setup();
    await registration.register(officer, 'u2', 'Padrinho');
    expect(members.roles('u2')).toEqual([roleId('soldier'), roleId('class-cleric')]);
  });

  it('refuses a character the site does not know, a member not in the server, or a site down', async () => {
    const { registration, registrations } = setup();
    expect(await registration.register(officer, 'u1', 'Ninguem')).toMatchObject({
      status: 'rejected',
      reason: expect.stringContaining('Ninguem'),
    });
    expect(await registration.register(officer, 'u9', 'Padrinho')).toMatchObject({
      status: 'rejected',
    });
    expect(registrations.all()).toEqual([]);
    const down = setup({ siteDown: true });
    expect(await down.registration.register(officer, 'u1', 'Padrinho')).toMatchObject({
      status: 'rejected',
      reason: expect.stringContaining('site'),
    });
  });

  it('moves a character someone else has only with confirm; the old account becomes Restrito', async () => {
    const { registration, registrations, members, restrictions, sent } = setup();
    await registration.register(officer, 'u2', 'Padrinho');

    expect(await registration.register(officer, 'u1', 'Padrinho')).toMatchObject({
      status: 'rejected',
      reason: expect.stringContaining('<@u2>'),
    });
    expect(sent.at(-1)?.content).toContain('já está cadastrado para <@u2>');
    expect(registrations.get('u1')).toBeUndefined();

    expect(await registration.register(officer, 'u1', 'Padrinho', true)).toMatchObject({
      status: 'ok',
    });
    expect(registrations.get('u2')).toBeUndefined();
    expect(registrations.get('u1')).toMatchObject({ characterId: padrinho.id });
    expect(members.roles('u2')).toEqual([roleId('class-cleric'), roleId('restricted')]);
    expect(restrictions.get('u2')).toMatchObject({ origin: 'transfer' });
    expect(sent.at(-1)?.content).toContain('passou de <@u2> para <@u1>');
  });
});
