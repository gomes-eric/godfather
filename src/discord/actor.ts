import type { Guild, GuildMember } from 'discord.js';
import type { Actor, ActorSource } from '../core/actor.js';
import { resolveTier, type Tier } from '../core/tiers.js';
import type { GuildDirectory } from './directory.js';

/** Tier of a member from their roles as they are right now. */
export function memberTier(member: GuildMember, directory: GuildDirectory): Tier {
  return resolveTier(
    { roleIds: member.roles.cache.keys(), isOwner: member.guild.ownerId === member.id },
    directory.tierRoleIds(),
  );
}

/** Builds an Actor from the member's roles as they are right now. */
export async function resolveActor(
  guild: Guild,
  directory: GuildDirectory,
  userId: string,
  source: ActorSource,
  harness?: string,
): Promise<Actor> {
  const member = await guild.members.fetch(userId).catch(() => null);
  const tier = member ? memberTier(member, directory) : 'visitor';
  return { userId, tier, source, ...(harness !== undefined && { harness }) };
}
