import type { Guild } from 'discord.js';
import type { Actor, ActorSource } from '../core/actor.js';
import { resolveTier } from '../core/tiers.js';
import type { GuildDirectory } from './directory.js';

/** Builds an Actor from the member's roles as they are right now. */
export async function resolveActor(
  guild: Guild,
  directory: GuildDirectory,
  userId: string,
  source: ActorSource,
  harness?: string,
): Promise<Actor> {
  const member = await guild.members.fetch(userId).catch(() => null);
  const tier = member
    ? resolveTier(
        { roleIds: member.roles.cache.keys(), isOwner: guild.ownerId === userId },
        directory.tierRoleIds(),
      )
    : 'visitor';

  return { userId, tier, source, ...(harness !== undefined && { harness }) };
}
