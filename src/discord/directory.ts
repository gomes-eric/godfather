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

/** Resolves configured roles and channels to live Discord objects. */
export interface GuildDirectory {
  roleId(key: string): string | undefined;
  tierRoleIds(): TierRoleIds;
  /** Visitante, which sits below the ranked tiers. */
  visitorRoleId(): string | undefined;
  /** Every role that marks a member's standing: tiers, Aliado and the alliances, Parceiro... */
  standingRoles(): StandingRoles;
  /** Ids of every class role that exists in Discord. */
  classRoleIds(): string[];
  /** The member's class roles, in server.yaml order. */
  classesOf(member: { roles: { cache: { has(id: string): boolean } } }): RoleConfig[];
  channelByKey(key: string): TextChannel | undefined;
}

/**
 * Uses the ids recorded by /setup (managed_objects), which survive renames. Before the first
 * /setup, falls back to looking objects up by their configured name.
 */
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
