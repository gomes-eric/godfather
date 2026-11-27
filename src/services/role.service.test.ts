import { describe, expect, it } from 'vitest';
import type { Actor } from '../core/actor.js';
import { ptBR } from '../i18n/pt-BR.js';
import { RoleService } from './role.service.js';
import { FakeGuildAdmin } from './testing/fake-guild-admin.js';
import { recordingRunner } from './testing/recording-runner.js';

const t = ptBR.roles;
const commander: Actor = { userId: 'u-cmd', tier: 'commander', source: 'mcp' };
const officer: Actor = { userId: 'u-off', tier: 'officer', source: 'mcp' };

function setup() {
  const guild = new FakeGuildAdmin();
  guild.botPosition = 10;
  const soldierRole = guild.seedRole({ name: 'Soldado', position: 3 });
  const leaderRole = guild.seedRole({ name: 'Líder Aliado', position: 3 });
  const { runAction, audit } = recordingRunner();
  const service = new RoleService({
    guild,
    directory: {
      standingRoles: () => ({ tiers: { soldier: soldierRole }, alliances: {} }),
      allyLeaderRoleId: () => leaderRole,
    },
    runAction,
  });
  return { guild, service, audit, soldierRole };
}

describe('RoleService', () => {
  it('creates a role with the parsed color', async () => {
    const { guild, service } = setup();

    const outcome = await service.create(commander, { name: 'Raide', color: '#FF8800' });

    expect(outcome).toEqual({ status: 'ok', value: t.created('Raide') });
    expect(guild.roleList.find((r) => r.name === 'Raide')).toMatchObject({ color: 0xff8800 });
  });

  it('refuses a role at or above the bot only to a Comandante', async () => {
    const { guild, service, audit } = setup();
    guild.seedRole({ name: 'Staff', position: 10 });

    expect(await service.edit(officer, 'Staff', { name: 'Equipe' })).toEqual({
      status: 'denied',
      requiredTier: 'commander',
    });
    expect(await service.edit(commander, 'Staff', { name: 'Equipe' })).toEqual({
      status: 'rejected',
      reason: t.aboveBot,
    });
    expect(audit.map((e) => e.result)).toEqual(['denied', 'rejected']);
  });

  it('refuses roles owned by an integration', async () => {
    const { guild, service } = setup();
    guild.seedRole({ name: 'Música', position: 2, managed: true });

    expect(await service.delete(commander, 'Música', true)).toEqual({
      status: 'rejected',
      reason: t.integration,
    });
  });

  it('says a role does not exist only after checking the rank', async () => {
    const { service } = setup();

    expect(await service.delete(officer, 'Fantasma', true)).toMatchObject({ status: 'denied' });
    expect(await service.delete(commander, 'Fantasma', true)).toEqual({
      status: 'rejected',
      reason: ptBR.resolve.none(ptBR.resolve.what.role, 'Fantasma'),
    });
  });

  it('shows how many people hold a role before deleting it', async () => {
    const { guild, service } = setup();
    const raid = guild.seedRole({ name: 'Raide', position: 2 });
    guild.seedMember({ displayName: 'Padrinho', roleIds: [raid] });

    expect(await service.delete(commander, 'Raide', false)).toEqual({
      status: 'confirmation_required',
      preview: t.deletePreview('Raide', 1),
    });
    expect(await service.delete(commander, 'Raide', true)).toEqual({
      status: 'ok',
      value: t.deleted('Raide'),
    });
    expect(guild.roleList.some((r) => r.id === raid)).toBe(false);
  });

  it('assigns and removes roles outside the legion ranks', async () => {
    const { guild, service } = setup();
    const raid = guild.seedRole({ name: 'Raide', position: 2 });
    const padrinho = guild.seedMember({ displayName: 'Padrinho' });

    expect(await service.setAssignment(commander, 'Padrinho', 'Raide', true)).toEqual({
      status: 'ok',
      value: t.assigned('Raide', 'Padrinho'),
    });
    expect(padrinho.roleIds).toEqual([raid]);

    await service.setAssignment(commander, 'Padrinho', 'Raide', false);
    expect(padrinho.roleIds).toEqual([]);
  });

  it('keeps rank roles to promote and demote', async () => {
    const { guild, service, soldierRole } = setup();
    const padrinho = guild.seedMember({ displayName: 'Padrinho' });

    expect(await service.setAssignment(commander, 'Padrinho', 'Soldado', true)).toEqual({
      status: 'rejected',
      reason: t.tierRole,
    });
    expect(padrinho.roleIds).not.toContain(soldierRole);
    expect(await service.setAssignment(commander, 'Padrinho', 'Líder Aliado', true)).toEqual({
      status: 'rejected',
      reason: t.tierRole,
    });
  });
});
