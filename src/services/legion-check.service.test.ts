import { describe, expect, it } from 'vitest';
import type { ConfigStore } from '../config/store.js';
import type { ActionRunner } from '../core/action.js';
import { CharacterStore } from '../db/characters.js';
import { openDatabase } from '../db/client.js';
import { ManagedObjectStore } from '../db/managed-objects.js';
import type { GuildDirectory } from '../discord/directory.js';
import type { Logger } from '../logger.js';
import type { Actor } from '../core/actor.js';
import { RestrictionStore } from '../db/restrictions.js';
import type { Standing } from '../core/standing.js';
import type { GameCharacterService } from './game-character.service.js';
import { LegionCheckService } from './legion-check.service.js';
import type { MemberService } from './member.service.js';
import type { ReviewInput } from './recruitment.service.js';

const config = {
  get: () => ({
    alliances: [{ key: 'ally-noxus', legion: 'Noxus' }],
    roles: [
      { key: 'class-cleric', name: 'Clérigo', class: true, emoji: '✨' },
      { key: 'class-sorcerer', name: 'Mago', class: true, emoji: '🔥' },
    ],
    settings: {
      characters: {
        legion: 'M4F1A',
        reportChannel: 'officers',
        rankingChannel: 'ranking',
        recruitmentChannel: 'recruitment',
      },
    },
  }),
} as unknown as ConfigStore;
const logger = { info: () => undefined, warn: () => undefined } as unknown as Logger;

const describeStanding = (s: Standing) =>
  s.kind === 'tier' ? s.tier : s.kind === 'ally' ? `ally:${s.allianceKey}` : s.kind;

function setup(
  profile: { name: string; className: string; legion: string },
  options: { registered?: string[]; standingRole?: string } = {},
) {
  const db = openDatabase(':memory:');
  const registrations = new CharacterStore(db.db);
  const restrictions = new RestrictionStore(db.db);
  for (const userId of options.registered ?? ['u1']) {
    registrations.save({
      userId,
      characterId: `c-${userId}`,
      serverId: 2403,
      name: 'Padrinho',
      classKey: 'class-cleric',
      legion: 'M4F1A',
      combatPower: 100,
      itemLevel: 2000,
    });
  }
  const moves: string[] = [];
  const reviews: ReviewInput[] = [];

  const posted: { channel: string; text: string }[] = [];
  const nicknames: string[] = [];
  const roleSets: string[][] = [];
  const member = {
    id: 'u1',
    guild: { id: 'guild', ownerId: 'owner' },
    manageable: true,
    roles: {
      cache: new Map([
        ['guild', {}],
        ['role-cleric', {}],
        [options.standingRole ?? 'soldier', {}],
      ]),
      set: async (ids: string[]) => void roleSets.push(ids),
    },
    setNickname: async (nick: string) => void nicknames.push(nick),
  };
  const channel = (name: string) => ({
    send: async (message: { embeds: { toJSON(): { description?: string } }[] }) => {
      posted.push({ channel: name, text: message.embeds[0]!.toJSON().description ?? '' });
      return { id: `${name}-msg` };
    },
    messages: { fetch: async () => null },
  });
  const guild = {
    id: 'guild',
    ownerId: 'owner',
    client: { user: { id: 'bot' } },
    members: {
      fetch: async (arg?: unknown) =>
        typeof arg === 'object' && arg !== null && 'user' in arg
          ? new Map([['u1', member]])
          : member,
      cache: new Map(),
    },
  };
  const directory = {
    channelByKey: (key: string) => channel(key),
    roleId: (key: string) =>
      ({ 'class-cleric': 'role-cleric', 'class-sorcerer': 'role-mage' })[key],
    classRoleIds: () => ['role-cleric', 'role-mage'],
    standingRoles: () => ({
      tiers: { soldier: 'soldier', officer: 'officer' },
      restricted: 'restricted',
      ally: 'ally',
      alliances: { 'ally-noxus': 'noxus' },
    }),
  } as unknown as GuildDirectory;
  const members = {
    standingName: describeStanding,
    legionOf: (s: Standing) => (s.kind === 'ally' ? 'Noxus' : undefined),
    move: async (actor: Actor, userId: string, to: Standing) => {
      moves.push(`${actor.userId} ${userId} ${describeStanding(to)}`);
      return { status: 'ok', value: '' };
    },
  } as unknown as MemberService;
  const runAction = (async (request: { execute: () => Promise<unknown> }) => ({
    status: 'ok',
    value: await request.execute(),
  })) as unknown as ActionRunner;

  const service = new LegionCheckService({
    guild: guild as never,
    config,
    directory,
    managed: new ManagedObjectStore(db.db),
    registrations,
    characters: {
      profile: async () => ({ ...profile, combatPower: 150, itemLevel: 2100 }),
    } as unknown as GameCharacterService,
    runAction,
    members,
    restrictions,
    review: async (input) => void reviews.push(input),
    logger,
    pause: async () => undefined,
  });
  return { service, registrations, restrictions, posted, nicknames, roleSets, moves, reviews };
}

describe('LegionCheckService', () => {
  it('syncs a new class and name, restricts a Soldado who left and opens a review', async () => {
    const { service, registrations, posted, nicknames, roleSets, moves, reviews } = setup({
      name: 'Padrinho2',
      className: 'Mago',
      legion: 'Outra',
    });

    const report = await service.check();

    expect(report).toHaveLength(3);
    expect(report.join('\n')).toContain('**Padrinho** → **Padrinho2**');
    expect(report.join('\n')).toContain('**Clérigo** → **Mago**');
    expect(report.join('\n')).toContain('virou **restricted**');
    expect(moves).toEqual(['bot u1 restricted']);
    expect(reviews).toEqual([
      expect.objectContaining({ userId: 'u1', kind: 'restricted', previousStanding: 'soldier' }),
    ]);
    expect(nicknames).toEqual(['🔥 Padrinho2']);
    expect(roleSets).toEqual([['soldier', 'role-mage']]);
    expect(posted[0]!.channel).toBe('officers');
    expect(registrations.get('u1')).toMatchObject({
      name: 'Padrinho2',
      classKey: 'class-sorcerer',
      legion: 'Outra',
      combatPower: 150,
    });
  });

  it('makes a Soldado who moved to an allied legion an Aliado of it', async () => {
    const { service, moves, reviews } = setup({
      name: 'Padrinho',
      className: 'Clérigo',
      legion: 'Noxus',
    });
    await service.check();
    expect(moves).toEqual(['bot u1 ally:ally-noxus']);
    expect(reviews).toEqual([expect.objectContaining({ kind: 'ally', allianceLegion: 'Noxus' })]);
  });

  it('only reports an Oficial who left, with a review', async () => {
    const { service, moves, reviews } = setup(
      { name: 'Padrinho', className: 'Clérigo', legion: 'Outra' },
      { standingRole: 'officer' },
    );
    const report = await service.check();
    expect(moves).toEqual([]);
    expect(report.join('\n')).toContain('O cargo não muda sozinho');
    expect(reviews).toEqual([expect.objectContaining({ previousStanding: 'officer' })]);
  });

  it('moves nobody when more than 3 seem to leave at once, and checks them again next time', async () => {
    const { service, registrations, moves, reviews } = setup(
      { name: 'Padrinho', className: 'Clérigo', legion: '' },
      { registered: ['u1', 'u2', 'u3', 'u4'] },
    );
    const report = await service.check();
    expect(moves).toEqual([]);
    expect(reviews).toEqual([]);
    expect(report.join('\n')).toContain('ninguém mudou de cargo');
    expect(registrations.get('u1')?.legion).toBe('M4F1A');
  });

  it('gives Soldado back to someone the check restricted who returned', async () => {
    const { service, restrictions, moves } = setup(
      { name: 'Padrinho', className: 'Clérigo', legion: 'M4F1A' },
      { standingRole: 'restricted' },
    );
    restrictions.set({ userId: 'u1', origin: 'check', reason: null, by: 'bot' });
    await service.check();
    expect(moves).toEqual(['bot u1 soldier']);
  });

  it('leaves a restriction by an officer alone', async () => {
    const { service, restrictions, moves } = setup(
      { name: 'Padrinho', className: 'Clérigo', legion: 'M4F1A' },
      { standingRole: 'restricted' },
    );
    restrictions.set({ userId: 'u1', origin: 'manual', reason: 'spam', by: 'officer' });
    await service.check();
    expect(moves).toEqual([]);
  });

  it('stays quiet when nothing changed, and only rebuilds the ranking', async () => {
    const { service, posted } = setup({ name: 'Padrinho', className: 'Clérigo', legion: 'M4F1A' });

    expect(await service.check()).toEqual([]);
    expect(posted.map((p) => p.channel)).toEqual(['ranking']);
    expect(posted[0]!.text).toContain('🥇 ✨ **Padrinho** · ⚔️ 150 · 🎚️ 2.100');
  });

  it('is not due again right after a check', async () => {
    const { service } = setup({ name: 'Padrinho', className: 'Clérigo', legion: 'M4F1A' });
    expect(await service.runIfDue()).toEqual([]);
  });

  it('takes the first check of an old registration as the baseline, without legion reports', async () => {
    const { service, registrations } = setup({
      name: 'Padrinho',
      className: 'Clérigo',
      legion: 'M4F1A',
    });
    registrations.updateSnapshot('u1', {
      name: 'Padrinho',
      classKey: 'class-cleric',
      legion: '',
      combatPower: null,
      itemLevel: null,
    });
    (registrations as unknown as { db: { run(q: unknown): void } }).db.run(
      (await import('drizzle-orm')).sql`update registered_characters set checked_at = null`,
    );

    expect(await service.check()).toEqual([]);
    expect(registrations.get('u1')?.legion).toBe('M4F1A');
  });
});
