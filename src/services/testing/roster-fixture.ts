import type { TextChannel } from 'discord.js';
import { classRoles, tierRoleKeys, type ServerConfig } from '../../config/schema.js';
import { ConfigStore } from '../../config/store.js';
import type { ActionRunner } from '../../core/action.js';
import type { RankedTier, TierRoleIds } from '../../core/tiers.js';
import { openDatabase } from '../../db/client.js';
import { RestrictionStore } from '../../db/restrictions.js';
import type { GuildDirectory } from '../../discord/directory.js';
import { CharacterStore } from '../../db/characters.js';
import type { Logger } from '../../logger.js';
import { GameApiError, type GameCharacterService } from '../game-character.service.js';
import type { RankingBoard } from '../ranking-board.service.js';
import { RegistrationService } from '../registration.service.js';
import { Roster } from '../roster.service.js';
import { copyRepoYaml } from '../../config/testing/repo-yaml.js';
import { FakeMembers } from './fake-members.js';

/** A role's id in the fake guild: the role key itself, prefixed. */
export const roleId = (key: string) => `role:${key}`;

/** server.yaml copied to a temp file, so tests may write alliances to it. */
export function testConfig(): ConfigStore {
  return new ConfigStore(copyRepoYaml());
}

/** Every configured role (and alliance) exists, with id `role:<key>`; channels post into `sent`. */
export function fakeDirectory(
  config: () => ServerConfig,
  sent: { channel: string; content: string }[] = [],
) {
  const exists = (key: string) =>
    config().roles.some((r) => r.key === key) || config().alliances.some((a) => a.key === key);
  const id = (key: string | undefined) => (key && exists(key) ? roleId(key) : undefined);
  const tierRoleIds = (): TierRoleIds => {
    const ids: TierRoleIds = {};
    for (const [tier, key] of Object.entries(tierRoleKeys(config())) as [RankedTier, string][]) {
      ids[tier] = roleId(key);
    }
    return ids;
  };
  const channel = (key: string) =>
    ({
      id: `channel:${key}`,
      send: async (message: { content?: string }) => {
        sent.push({ channel: key, content: message.content ?? '' });
        return { id: `message:${sent.length}` };
      },
    }) as unknown as TextChannel;
  const directory: GuildDirectory = {
    roleId: id,
    tierRoleIds,
    visitorRoleId: () => id(config().roles.find((r) => r.tier === 'visitor')?.key),
    standingRoles: () => {
      const { settings, alliances } = config();
      return {
        tiers: tierRoleIds(),
        visitor: id(config().roles.find((r) => r.tier === 'visitor')?.key),
        partner: id(settings.partnerRole),
        restricted: id(settings.restrictedRole),
        ally: id(settings.allyRole),
        alliances: Object.fromEntries(alliances.map((a) => [a.key, roleId(a.key)])),
      };
    },
    allyLeaderRoleId: () => id(config().settings.allyLeaderRole),
    classRoleIds: () => classRoles(config()).map((r) => roleId(r.key)),
    classesOf: () => [],
    channelByKey: channel,
  };
  return directory;
}

export const passThroughRunner = (async (request: { execute: () => Promise<unknown> }) => ({
  status: 'ok',
  value: await request.execute(),
})) as unknown as ActionRunner;

/** A roster over the real server.yaml, an in-memory database and fake members. */
export function rosterFixture(options: { runAction?: ActionRunner } = {}) {
  const config = testConfig();
  const db = openDatabase(':memory:');
  const sent: { channel: string; content: string }[] = [];
  const directory = fakeDirectory(() => config.get(), sent);
  const members = new FakeMembers();
  const restrictions = new RestrictionStore(db.db);
  const roster = new Roster({
    members,
    directory,
    config,
    restrictions,
    runAction: options.runAction ?? passThroughRunner,
  });
  return { config, db, directory, members, restrictions, roster, sent };
}

export const profile = (name: string, legion = '', className = 'Clérigo') => ({
  id: `c-${name}`,
  name,
  serverId: 2403,
  className,
  level: 45,
  combatPower: 100_000,
  itemLevel: 2000,
  legion,
  title: null,
  avatarUrl: null,
});

/** The roster plus character registration, with the official site answering from `characters`. */
export function registrationFixture(
  characters: Record<string, ReturnType<typeof profile>> = {},
  options: { siteDown?: boolean; runAction?: ActionRunner } = {},
) {
  const f = rosterFixture(options);
  const registrations = new CharacterStore(f.db.db);
  const site = {
    find: async (name: string) => {
      if (options.siteDown) throw new GameApiError('down');
      const found = Object.values(characters).find(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
      );
      return found ? { id: found.id, name: found.name, serverId: found.serverId } : null;
    },
    profile: async (ref: { id: string }) => Object.values(characters).find((c) => c.id === ref.id)!,
  } as unknown as GameCharacterService;
  const registration = new RegistrationService({
    config: f.config,
    directory: f.directory,
    registrations,
    characters: site,
    roster: f.roster,
    ranking: { refresh: async () => undefined } as unknown as RankingBoard,
    runAction: options.runAction ?? passThroughRunner,
    logger: { warn: () => undefined } as unknown as Logger,
  });
  return { ...f, registrations, registration };
}
