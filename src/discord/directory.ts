import { ChannelType, type Guild, type TextChannel } from 'discord.js';
import { channelNameByKey, tierRoleKeys, type ServerConfig } from '../config/schema.js';
import type { RankedTier, TierRoleIds } from '../core/tiers.js';
import type { ManagedObjectStore } from '../db/managed-objects.js';

/** Resolves configured roles and channels to live Discord objects. */
export interface GuildDirectory {
  tierRoleIds(): TierRoleIds;
  roleId(key: string): string | undefined;
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
    const name = config().roles.find((r) => r.key === key)?.name;
    return name ? guild.roles.cache.find((r) => r.name === name)?.id : undefined;
  };

  return {
    roleId,

    tierRoleIds() {
      const ids: TierRoleIds = {};
      for (const [tier, key] of Object.entries(tierRoleKeys(config())) as [RankedTier, string][]) {
        const id = roleId(key);
        if (id) ids[tier] = id;
      }
      return ids;
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
