import { ChannelType, type Guild, type TextChannel } from 'discord.js';
import {
  channelNameByKey,
  classRoles,
  tierRoleKeys,
  type RoleConfig,
  type ServerConfig,
} from '../config/schema.js';
import type { StandingRoles } from '../core/standing.js';
import type { RankedTier, TierRoleIds } from '../core/tiers.js';
import type { ManagedObjectStore } from '../db/managed-objects.js';

export interface GuildDirectory {
  roleId(key: string): string | undefined;
  tierRoleIds(): TierRoleIds;
  visitorRoleId(): string | undefined;
  standingRoles(): StandingRoles;
  allyLeaderRoleId(): string | undefined;
  classRoleIds(): string[];
  classesOf(member: { roles: { cache: { has(id: string): boolean } } }): RoleConfig[];
  channelByKey(key: string): TextChannel | undefined;
}

export function createDirectory(
  guild: Guild,
  store: ManagedObjectStore,
  config: () => ServerConfig,
): GuildDirectory {
  const roleId = (key: string) => {
    const managed = store.get('role', key)?.discordId;
    if (managed && guild.roles.cache.has(managed)) return managed;
    const name =
      config().roles.find((r) => r.key === key)?.name ??
      config().alliances.find((a) => a.key === key)?.legion;
    return name ? guild.roles.cache.find((r) => r.name === name)?.id : undefined;
  };
  const settingRole = (key: string | undefined) => (key ? roleId(key) : undefined);
  const tierRoleIds = () => {
    const ids: TierRoleIds = {};
    for (const [tier, key] of Object.entries(tierRoleKeys(config())) as [RankedTier, string][]) {
      const id = roleId(key);
      if (id) ids[tier] = id;
    }
    return ids;
  };
  const visitorRoleId = () => settingRole(config().roles.find((r) => r.tier === 'visitor')?.key);

  return {
    roleId,

    tierRoleIds,
    visitorRoleId,

    allyLeaderRoleId: () => settingRole(config().settings.allyLeaderRole),

    standingRoles() {
      const { settings, alliances } = config();
      const allianceIds: Record<string, string> = {};
      for (const alliance of alliances) {
        const id = roleId(alliance.key);
        if (id) allianceIds[alliance.key] = id;
      }
      return {
        tiers: tierRoleIds(),
        visitor: visitorRoleId(),
        partner: settingRole(settings.partnerRole),
        restricted: settingRole(settings.restrictedRole),
        ally: settingRole(settings.allyRole),
        alliances: allianceIds,
      };
    },

    classRoleIds() {
      return classRoles(config())
        .map((role) => roleId(role.key))
        .filter((id): id is string => id !== undefined);
    },

    classesOf(member) {
      return classRoles(config()).filter((role) => {
        const id = roleId(role.key);
        return id !== undefined && member.roles.cache.has(id);
      });
    },

    channelByKey(key) {
      const isText = (c: unknown): c is TextChannel =>
        (c as { type?: ChannelType } | undefined)?.type === ChannelType.GuildText;

      const managed = store.get('channel', key)?.discordId;
      const byId = managed ? guild.channels.cache.get(managed) : undefined;
      if (isText(byId)) return byId;

      const name = channelNameByKey(config(), key);
      return name
        ? (guild.channels.cache.find((c) => isText(c) && c.name === name) as
            TextChannel | undefined)
        : undefined;
    },
  };
}
