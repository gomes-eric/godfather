import { describe, expect, it } from 'vitest';
import type { Actor } from '../core/actor.js';
import type { Tier } from '../core/tiers.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { MemberView } from './guild-admin-port.js';
import { ModerationService } from './moderation.service.js';
import { FakeGuildAdmin } from './testing/fake-guild-admin.js';
import { recordingRunner } from './testing/recording-runner.js';

const ROLE = { commander: 'r-cmd', officer: 'r-off', soldier: 'r-sol' } as const;
const DAY = 24 * 60 * 60 * 1000;
const tooHigh = ptBR.members.refusals.targetTooHigh;

function setup() {
  const guild = new FakeGuildAdmin();
  const now = new Date('2026-11-27T12:00:00Z');
  guild.now = () => now;
  const { runAction, audit } = recordingRunner();
  const service = new ModerationService({
    guild,
    directory: { standingRoles: () => ({ tiers: ROLE, alliances: {} }) },
    runAction,
    now: () => now,
  });
  const member = (displayName: string, tier?: keyof typeof ROLE, fields?: Partial<MemberView>) =>
    guild.seedMember({ displayName, roleIds: tier ? [ROLE[tier]] : [], ...fields });
  const as = (who: MemberView, tier: Tier): Actor => ({ userId: who.id, tier, source: 'slash' });
  return { guild, service, audit, member, as };
}

describe('ModerationService.kick', () => {
  it('denies a Soldado by rank and never tells them about the target', async () => {
    const { guild, service, audit, member, as } = setup();
    const soldier = member('Soldado', 'soldier');
    const officer = member('Padrinho', 'officer');

    const outcome = await service.kick(as(soldier, 'soldier'), officer.id, null, true);

    expect(outcome).toEqual({ status: 'denied', requiredTier: 'officer' });
    expect(guild.memberList.has(officer.id)).toBe(true);
    expect(audit).toEqual([
      expect.objectContaining({ action: 'member.kick', result: 'denied', target: 'Padrinho' }),
    ]);
  });

  it('refuses an Oficial kicking another Oficial, and audits the refusal', async () => {
    const { guild, service, audit, member, as } = setup();
    const actor = member('Oficial', 'officer');
    const officer = member('Padrinho', 'officer');

    const outcome = await service.kick(as(actor, 'officer'), officer.id, 'flood', true);

    expect(outcome).toEqual({ status: 'rejected', reason: tooHigh });
    expect(guild.memberList.has(officer.id)).toBe(true);
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'member.kick',
        result: 'rejected',
        params: { userId: officer.id, reason: 'flood', refusal: tooHigh },
      }),
    ]);
  });

  it('kicks a Soldado once the Oficial confirms', async () => {
    const { guild, service, audit, member, as } = setup();
    const actor = as(member('Oficial', 'officer'), 'officer');
    const soldier = member('Padrinho', 'soldier');

    expect(await service.kick(actor, soldier.id, null, false)).toMatchObject({
      status: 'confirmation_required',
    });
    expect(await service.kick(actor, soldier.id, null, true)).toEqual({
      status: 'ok',
      value: ptBR.moderation.kicked('Padrinho'),
    });
    expect(guild.memberList.has(soldier.id)).toBe(false);
    expect(audit.map((e) => e.result)).toEqual(['confirmation_required', 'ok']);
  });

  it('says someone is not in the server only to those allowed to kick', async () => {
    const { service, audit, member, as } = setup();
    const soldier = as(member('Soldado', 'soldier'), 'soldier');
    const officer = as(member('Oficial', 'officer'), 'officer');

    expect(await service.kick(soldier, '123456789012345678', null, true)).toEqual({
      status: 'denied',
      requiredTier: 'officer',
    });
    expect(await service.kick(officer, '123456789012345678', null, true)).toEqual({
      status: 'rejected',
      reason: ptBR.members.notMember,
    });
    expect(audit.map((e) => e.result)).toEqual(['denied', 'rejected']);
  });

  it('refuses the owner, bots and members above the bot', async () => {
    const { guild, service, member, as } = setup();
    const actor = as(member('Comandante', 'commander'), 'commander');
    const owner = member('Dono');
    guild.owner = owner.id;
    const bot = member('Bot', undefined, { bot: true });
    const unreachable = member('Padrinho', 'soldier', { kickable: false });

    const reasons = [];
    for (const target of [owner, bot, unreachable]) {
      const outcome = await service.kick(actor, target.id, null, true);
      reasons.push(outcome.status === 'rejected' ? outcome.reason : outcome.status);
    }

    expect(reasons).toEqual([
      ptBR.members.refusals.targetIsOwner,
      ptBR.members.refusals.targetIsBot,
      ptBR.members.botCannot,
    ]);
  });
});

describe('ModerationService.timeout', () => {
  it('caps the duration at the 28 days Discord allows', async () => {
    const { guild, service, audit, member, as } = setup();
    const actor = as(member('Oficial', 'officer'), 'officer');
    const soldier = member('Padrinho', 'soldier');

    const outcome = await service.timeout(actor, soldier.id, 100_000, null);

    expect(outcome).toEqual({
      status: 'ok',
      value: ptBR.moderation.timedOut('Padrinho', 40_320),
    });
    expect(guild.timeouts.get(soldier.id)).toBe(28 * DAY);
    expect(audit[0]).toMatchObject({ result: 'ok', params: { minutes: 40_320 } });
  });

  it('lifts the timeout for zero or negative minutes', async () => {
    const { guild, service, member, as } = setup();
    const actor = as(member('Oficial', 'officer'), 'officer');
    const soldier = member('Padrinho', 'soldier');

    const outcome = await service.timeout(actor, soldier.id, -5, 'perdoado');

    expect(outcome).toEqual({ status: 'ok', value: ptBR.moderation.timeoutRemoved('Padrinho') });
    expect(guild.timeouts.get(soldier.id)).toBeNull();
  });
});

describe('ModerationService.ban and unban', () => {
  it('bans someone who already left, deleting the chosen hours of messages', async () => {
    const { guild, service, member, as } = setup();
    const commander = as(member('Comandante', 'commander'), 'commander');
    const gone = guild.seedUser('padrinho');

    const outcome = await service.ban(commander, gone.id, 'spam', 24, true);

    expect(outcome).toEqual({ status: 'ok', value: ptBR.moderation.banned('padrinho') });
    expect(guild.bans.get(gone.id)).toMatchObject({ reason: 'spam', deleteMessageSeconds: 86_400 });
  });

  it('tells only a Comandante that someone is not banned', async () => {
    const { service, audit, member, as } = setup();
    const officer = as(member('Oficial', 'officer'), 'officer');
    const commander = as(member('Comandante', 'commander'), 'commander');

    expect(await service.unban(officer, '123456789012345678', null)).toEqual({
      status: 'denied',
      requiredTier: 'commander',
    });
    expect(await service.unban(commander, '123456789012345678', null)).toEqual({
      status: 'rejected',
      reason: ptBR.moderation.notBanned,
    });
    expect(audit.map((e) => e.result)).toEqual(['denied', 'rejected']);
  });
});

describe('ModerationService.purge', () => {
  function channelWithHistory() {
    const context = setup();
    const { guild, member } = context;
    const channel = guild.seedChannel({ name: 'geral', kind: 'text' });
    const padrinho = member('Padrinho', 'soldier');
    const other = member('Outro', 'soldier');
    const old = guild.seedMessage(channel.id, padrinho.id, 15 * DAY);
    const ids = [
      guild.seedMessage(channel.id, padrinho.id, 3 * DAY),
      guild.seedMessage(channel.id, other.id, 2 * DAY),
      guild.seedMessage(channel.id, padrinho.id, DAY),
      guild.seedMessage(channel.id, other.id, 0),
    ];
    const remaining = () => (guild.messages.get(channel.id) ?? []).map((m) => m.id);
    return { ...context, channel, padrinho, old, ids, remaining };
  }

  it('deletes only the newest messages of the chosen author', async () => {
    const { service, member, as, channel, padrinho, old, ids, remaining } = channelWithHistory();
    const officer = as(member('Oficial', 'officer'), 'officer');

    const outcome = await service.purge(officer, channel.id, 1, padrinho.id, true);

    expect(outcome).toEqual({ status: 'ok', value: ptBR.moderation.purged(1, 'geral') });
    expect(remaining()).toEqual([old, ids[0], ids[1], ids[3]]);
  });

  it('skips messages older than 14 days, which Discord cannot bulk-delete', async () => {
    const { service, member, as, channel, old, remaining } = channelWithHistory();
    const officer = as(member('Oficial', 'officer'), 'officer');

    const outcome = await service.purge(officer, channel.id, 500, null, true);

    expect(outcome).toEqual({ status: 'ok', value: ptBR.moderation.purged(4, 'geral') });
    expect(remaining()).toEqual([old]);
  });

  it('caps the count at 100 and asks for confirmation first', async () => {
    const { service, audit, member, as, channel } = channelWithHistory();
    const officer = as(member('Oficial', 'officer'), 'officer');

    const outcome = await service.purge(officer, channel.id, 500, null, false);

    expect(outcome).toMatchObject({ status: 'confirmation_required' });
    expect(audit[0]).toMatchObject({ params: { channelId: channel.id, count: 100 } });
  });

  it('refuses channels that take no messages, after checking the rank', async () => {
    const { guild, service, member, as } = setup();
    const category = guild.seedChannel({ name: 'Raides', kind: 'category' });
    const soldier = as(member('Soldado', 'soldier'), 'soldier');
    const officer = as(member('Oficial', 'officer'), 'officer');

    expect(await service.purge(soldier, category.id, 10, null, true)).toMatchObject({
      status: 'denied',
    });
    expect(await service.purge(officer, category.id, 10, null, true)).toEqual({
      status: 'rejected',
      reason: ptBR.moderation.notText,
    });
  });
});
