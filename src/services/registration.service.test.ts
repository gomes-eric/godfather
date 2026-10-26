import { describe, expect, it } from 'vitest';
import type { ConfigStore } from '../config/store.js';
import type { ActionRunner } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { CharacterStore } from '../db/characters.js';
import { openDatabase } from '../db/client.js';
import type { GuildDirectory } from '../discord/directory.js';
import type { Logger } from '../logger.js';
import type { GameCharacterService } from './game-character.service.js';
import type { LegionCheckService } from './legion-check.service.js';
import type { MemberService } from './member.service.js';
import { RegistrationService } from './registration.service.js';

const officer: Actor = { userId: 'officer', tier: 'officer', source: 'mcp' };
const profile = {
  id: 'c1',
  name: 'Padrinho',
  serverId: 2403,
  className: 'Clérigo',
  level: 45,
  combatPower: 100_000,
  itemLevel: 2000,
  legion: 'M4F1A',
  title: null,
  avatarUrl: null,
};

function setup(options: { found?: boolean; tierRoles?: Record<string, string> } = {}) {
  const db = openDatabase(':memory:');
  const registrations = new CharacterStore(db.db);
  const roleSets: string[][] = [];
  const nicknames: string[] = [];
  const promoted: string[] = [];
  const member = {
    id: 'u1',
    displayName: 'Fulano',
    manageable: true,
    guild: { id: 'guild', ownerId: 'owner' },
    roles: {
      cache: new Map([['visitor-role', {}]]),
      set: async (ids: string[]) => void roleSets.push(ids),
    },
    setNickname: async (nick: string) => void nicknames.push(nick),
  };
  const service = new RegistrationService({
    guild: {
      members: { fetch: async (id: string) => (id === 'u1' ? member : null) },
    } as never,
    config: {
      get: () => ({
        roles: [{ key: 'class-cleric', name: 'Clérigo', class: true, emoji: '✨' }],
      }),
    } as unknown as ConfigStore,
    directory: {
      roleId: (key: string) => (key === 'class-cleric' ? 'cleric-role' : undefined),
      classRoleIds: () => ['cleric-role'],
      tierRoleIds: () => options.tierRoles ?? {},
    } as unknown as GuildDirectory,
    registrations,
    characters: {
      find: async () => (options.found === false ? null : profile),
      profile: async () => profile,
    } as unknown as GameCharacterService,
    members: {
      promote: async (_actor: Actor, userId: string) => {
        promoted.push(userId);
        return { status: 'ok', value: 'ok' };
      },
    } as unknown as MemberService,
    legion: { refreshRanking: async () => undefined } as unknown as LegionCheckService,
    runAction: (async (r: { execute: () => Promise<unknown> }) => ({
      status: 'ok',
      value: await r.execute(),
    })) as unknown as ActionRunner,
    logger: { warn: () => undefined } as unknown as Logger,
  });
  return { service, registrations, roleSets, nicknames, promoted };
}

describe('RegistrationService', () => {
  it('registers the character, sets class and nickname, and makes a Visitante a Soldado', async () => {
    const { service, registrations, roleSets, nicknames, promoted } = setup();

    const outcome = await service.register(officer, 'u1', '  padrinho ');

    expect(outcome).toMatchObject({ status: 'ok' });
    expect(roleSets).toEqual([['visitor-role', 'cleric-role']]);
    expect(nicknames).toEqual(['✨ Padrinho']);
    expect(promoted).toEqual(['u1']);
    expect(registrations.get('u1')).toMatchObject({ name: 'Padrinho', classKey: 'class-cleric' });
  });

  it('keeps the tier of someone already in the legion', async () => {
    const { service, promoted } = setup({ tierRoles: { soldier: 'visitor-role' } });
    await service.register(officer, 'u1', 'Padrinho');
    expect(promoted).toEqual([]);
  });

  it('refuses a character the official site does not know, or a member not in the server', async () => {
    const { service, registrations } = setup({ found: false });
    expect(await service.register(officer, 'u1', 'Ninguem')).toMatchObject({
      status: 'rejected',
      reason: expect.stringContaining('Ninguem'),
    });
    expect(await service.register(officer, 'u9', 'Padrinho')).toMatchObject({
      status: 'rejected',
    });
    expect(registrations.all()).toEqual([]);
  });
});
