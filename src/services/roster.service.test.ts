import { describe, expect, it } from 'vitest';
import type { Actor } from '../core/actor.js';
import { allyOf, PARTNER, RESTRICTED, SOLDIER } from '../core/standing.js';
import { roleId, rosterFixture } from './testing/roster-fixture.js';

const officer: Actor = { userId: 'officer', tier: 'officer', source: 'slash' };
const commander: Actor = { userId: 'commander', tier: 'commander', source: 'slash' };
const bot: Actor = { userId: 'padrinho', tier: 'commander', source: 'system' };

function setup() {
  const f = rosterFixture();
  f.members
    .add({ id: 'officer', roleIds: [roleId('officer')] })
    .add({ id: 'commander', roleIds: [roleId('commander')] })
    .add({
      id: 'u1',
      displayName: 'Padrinho',
      roleIds: [roleId('soldier'), roleId('class-cleric')],
    })
    .add({ id: 'u2', roleIds: [roleId('officer')] })
    .add({ id: 'v1', roleIds: [roleId('visitor')] });
  return f;
}

describe('Roster.change', () => {
  it('swaps the previous standing role and keeps the rest, in one write', async () => {
    const { roster, members } = setup();
    const outcome = await roster.change(officer, 'u1', {
      to: PARTNER,
      cause: { kind: 'officer', reason: null },
    });
    expect(outcome.status).toBe('ok');
    expect(members.roles('u1')).toEqual([roleId('class-cleric'), roleId('partner')]);
    expect(members.writes).toHaveLength(1);
  });

  it('writes standing, class role and nickname together, so the class is never lost', async () => {
    const { roster, members } = setup();
    const outcome = await roster.change(officer, 'v1', {
      to: SOLDIER,
      character: { classKey: 'class-sorcerer', gameName: 'Padrinho' },
      cause: { kind: 'recruitment' },
    });
    expect(outcome).toMatchObject({ status: 'ok', value: { nickname: '🔥 Padrinho' } });
    expect(members.roles('v1')).toEqual([roleId('soldier'), roleId('class-sorcerer')]);
    expect(members.writes).toEqual([
      expect.objectContaining({ userId: 'v1', nickname: '🔥 Padrinho' }),
    ]);

    await roster.change(officer, 'v1', { to: PARTNER, cause: { kind: 'officer', reason: null } });
    expect(members.roles('v1')).toEqual([roleId('class-sorcerer'), roleId('partner')]);
  });

  it('replaces the class role when the character changes class', async () => {
    const { roster, members } = setup();
    await roster.change(bot, 'u1', {
      character: { classKey: 'class-chanter', gameName: 'Padrinho' },
      cause: { kind: 'legionCheck' },
    });
    expect(members.roles('u1')).toEqual([roleId('soldier'), roleId('class-chanter')]);
  });

  it('never renames the server owner', async () => {
    const { roster, members } = setup();
    members.add({ id: 'owner', roleIds: [] });
    const outcome = await roster.change(bot, 'owner', {
      character: { classKey: 'class-cleric', gameName: 'Padrinho' },
      cause: { kind: 'legionCheck' },
    });
    expect(outcome).toMatchObject({ status: 'ok', value: { nickname: null } });
    expect(members.writes[0]).not.toHaveProperty('nickname');
  });

  it('keeps the rank rule: an officer cannot move another officer', async () => {
    const { roster, members } = setup();
    expect(
      await roster.change(officer, 'u2', { to: PARTNER, cause: { kind: 'officer', reason: null } }),
    ).toMatchObject({ status: 'rejected' });
    expect(await roster.check(commander, 'u2', PARTNER)).toBeNull();
    expect(members.writes).toEqual([]);
  });

  it('refuses a standing whose role does not exist', async () => {
    const { roster } = setup();
    expect(await roster.check(officer, 'u1', allyOf('ally-noxus'))).toMatch(/Rode \/setup/);
  });

  it('records why someone is Restrito, and forgets it when they move on', async () => {
    const { roster, restrictions } = setup();
    await roster.change(bot, 'u1', { to: RESTRICTED, cause: { kind: 'legionCheck' } });
    expect(restrictions.get('u1')?.origin).toBe('check');
    await roster.change(officer, 'u1', {
      to: RESTRICTED,
      cause: { kind: 'transfer', character: 'Padrinho' },
    });
    await roster.change(officer, 'u1', { to: SOLDIER, cause: { kind: 'officer', reason: null } });
    expect(restrictions.get('u1')).toBeUndefined();

    await roster.change(officer, 'u1', {
      to: RESTRICTED,
      cause: { kind: 'allianceEnded', legion: 'Noxus' },
    });
    expect(restrictions.get('u1')).toMatchObject({ origin: 'check' });
  });
});

describe('Líder Aliado', () => {
  it('marks only an ally, and is taken back when they stop being that ally', async () => {
    const { roster, members, config } = setup();
    config.addAlliance({ key: 'ally-noxus', legion: 'Noxus' });
    expect(await roster.setAllyLeader(officer, 'u1', true)).toMatchObject({
      status: 'rejected',
      reason: expect.stringContaining('Só um Aliado'),
    });

    await roster.ally(officer, 'v1', 'Noxus');
    expect(await roster.setAllyLeader(officer, 'v1', true)).toMatchObject({ status: 'ok' });
    expect(members.roles('v1')).toContain(roleId('ally-leader'));
    expect(await roster.setAllyLeader(officer, 'v1', true)).toMatchObject({ status: 'rejected' });

    await roster.change(bot, 'v1', {
      character: { classKey: 'class-cleric', gameName: 'Padrinho' },
      cause: { kind: 'legionCheck' },
    });
    expect(members.roles('v1')).toContain(roleId('ally-leader'));

    await roster.change(bot, 'v1', { to: RESTRICTED, cause: { kind: 'legionCheck' } });
    expect(members.roles('v1')).not.toContain(roleId('ally-leader'));
  });

  it('unmarks a leader and keeps them Aliado', async () => {
    const { roster, members, config } = setup();
    config.addAlliance({ key: 'ally-noxus', legion: 'Noxus' });
    await roster.ally(officer, 'v1', 'Noxus');
    await roster.setAllyLeader(officer, 'v1', true);
    expect(await roster.setAllyLeader(officer, 'v1', false)).toMatchObject({ status: 'ok' });
    expect(members.roles('v1')).toEqual([roleId('ally'), roleId('ally-noxus')]);
    expect(await roster.setAllyLeader(officer, 'v1', false)).toMatchObject({ status: 'rejected' });
  });
});

describe('Roster commands', () => {
  it('makes anyone a Parceiro without demoting them first', async () => {
    const { roster, members } = setup();
    expect(await roster.partner(officer, 'u1', false)).toMatchObject({ status: 'ok' });
    expect(members.roles('u1')).toContain(roleId('partner'));
    expect(await roster.partner(officer, 'u1', false)).toMatchObject({
      status: 'rejected',
      reason: 'Essa pessoa já é Parceiro.',
    });
    expect(await roster.partner(officer, 'u1', true)).toMatchObject({ status: 'ok' });
    expect(members.roles('u1')).toEqual([roleId('class-cleric'), roleId('visitor')]);
  });

  it('allies someone with an alliance named by its legion', async () => {
    const { roster, members, config } = setup();
    expect(await roster.ally(officer, 'v1', 'Noxus')).toMatchObject({ status: 'rejected' });
    config.addAlliance({ key: 'ally-noxus', legion: 'Noxus' });
    expect(await roster.ally(officer, 'v1', 'noxus')).toMatchObject({ status: 'ok' });
    expect(members.roles('v1')).toEqual([roleId('ally'), roleId('ally-noxus')]);
    expect(await roster.standingOf('v1')).toEqual(allyOf('ally-noxus'));
  });

  it('restricts with a reason the officers see, and lets an officer lift it', async () => {
    const { roster, members, restrictions, sent } = setup();
    expect(await roster.restrict(officer, 'u1', 'spam')).toMatchObject({ status: 'ok' });
    expect(restrictions.get('u1')).toMatchObject({ origin: 'officer', reason: 'spam' });
    expect(sent).toEqual([{ channel: 'officers', content: expect.stringContaining('spam') }]);
    expect(await roster.promote(officer, 'u1', 'soldier')).toMatchObject({ status: 'ok' });
    expect(members.roles('u1')).toContain(roleId('soldier'));
    expect(restrictions.get('u1')).toBeUndefined();
  });

  it('promotes on the ladder, with allies and partners starting from Visitante', async () => {
    const { roster, members } = setup();
    await roster.partner(officer, 'v1', false);
    expect(await roster.promote(officer, 'v1')).toMatchObject({ status: 'ok' });
    expect(members.roles('v1')).toEqual([roleId('soldier')]);
    expect(await roster.promote(officer, 'v1')).toMatchObject({ status: 'rejected' });
  });

  it('reports the standing by name', async () => {
    const { roster } = setup();
    expect(await roster.info(officer, 'u1')).toMatchObject({
      status: 'ok',
      value: { standing: 'Soldado', tier: 'soldier', classes: ['Clérigo'] },
    });
  });
});
