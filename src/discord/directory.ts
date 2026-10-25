import { ChannelType, type Guild, type TextChannel } from 'discord.js';
import { channelNameByKey, tierRoleNames, type ServerConfig } from '../config/schema.js';
import type { TierRoleIds } from '../core/tiers.js';

/** Resolves configured roles and channels to live Discord objects. */
export interface GuildDirectory {
  tierRoleIds(): TierRoleIds;
  channelByKey(key: string): TextChannel | undefined;
}

/**
 * Looks objects up by their configured name. Phase 2 replaces this with the ids recorded by
 * `/setup` (managed_objects), which survive renames.
 */
export function createNameDirectory(guild: Guild, config: () => ServerConfig): GuildDirectory {
  return {
    tierRoleIds() {
      const ids: TierRoleIds = {};
      for (const [tier, name] of Object.entries(tierRoleNames(config()))) {
        const role = guild.roles.cache.find((r) => r.name === name);
        if (role) ids[tier as keyof TierRoleIds] = role.id;
      }
      return ids;
    },

    channelByKey(key) {
      const name = channelNameByKey(config(), key);
      if (!name) return undefined;
      return guild.channels.cache.find(
        (c): c is TextChannel => c.type === ChannelType.GuildText && c.name === name,
      );
    },
  };
}
