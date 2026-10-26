import { describe, expect, it } from 'vitest';
import type { ConfigStore } from '../config/store.js';
import type { ActionRunner } from '../core/action.js';
import { CharacterStore } from '../db/characters.js';
import { openDatabase } from '../db/client.js';
import { ManagedObjectStore } from '../db/managed-objects.js';
import type { GuildDirectory } from '../discord/directory.js';
import type { Logger } from '../logger.js';
import type { GameCharacterService } from './game-character.service.js';
import { LegionCheckService } from './legion-check.service.js';

const config = {
  get: () => ({
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

function setup(profile: { name: string; className: string; legion: string }) {
  const db = openDatabase(':memory:');
  const registrations = new CharacterStore(db.db);
  registrations.save({
    userId: 'u1',
    characterId: 'c1',
    serverId: 2403,
    name: 'Padrinho',
    classKey: 'class-cleric',
    legion: 'M4F1A',
    combatPower: 100,
    itemLevel: 2000,
  });

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
        ['soldier', {}],
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
      // A list fetch answers with who is in the server; the cache starts empty, as after a restart.
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
  } as unknown as GuildDirectory;
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
    logger,
    pause: async () => undefined,
  });
  return { service, registrations, posted, nicknames, roleSets };
}

describe('LegionCheckService', () => {
  it('syncs a new class and name, reports leaving the legion and updates the numbers', async () => {
    const { service, registrations, posted, nicknames, roleSets } = setup({
      name: 'Padrinho2',
      className: 'Mago',
      legion: 'Outra',
    });

    const report = await service.check();

    expect(report).toHaveLength(3);
    expect(report.join('\n')).toContain('**Padrinho** → **Padrinho2**');
    expect(report.join('\n')).toContain('**Clérigo** → **Mago**');
    expect(report.join('\n')).toContain('saiu da **M4F1A**');
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

  it('stays quiet when nothing changed, and only rebuilds the ranking', async () => {
    const { service, posted } = setup({ name: 'Padrinho', className: 'Clérigo', legion: 'M4F1A' });

    expect(await service.check()).toEqual([]);
    expect(posted.map((p) => p.channel)).toEqual(['ranking']);
    expect(posted[0]!.text).toContain('🥇 ✨ **Padrinho** · ⚔️ 150 · 🎚️ 2.100');
  });

  it('is not due again right after a check', async () => {
    const { service } = setup({ name: 'Padrinho', className: 'Clérigo', legion: 'M4F1A' });
    expect(await service.runIfDue()).toEqual([]); // saved just now, so not due
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
    // Rows saved before migration 0009 have no checkedAt.
    (registrations as unknown as { db: { run(q: unknown): void } }).db.run(
      (await import('drizzle-orm')).sql`update registered_characters set checked_at = null`,
    );

    expect(await service.check()).toEqual([]);
    expect(registrations.get('u1')?.legion).toBe('M4F1A');
  });
});
