import type { Guild, GuildMember } from 'discord.js';
import type { Actor, ActorSource } from '../core/actor.js';
import { resolveTier, type Tier, type TierRoleIds } from '../core/tiers.js';
import type { GuildDirectory } from './directory.js';

/**
 * Tier of a member from their roles as they are right now. Pass `tierIds` when classifying many
 * members at once, so the role ids are looked up only once.
 */
export function memberTier(
  member: GuildMember,
  directory: GuildDirectory,
  tierIds: TierRoleIds = directory.tierRoleIds(),
): Tier {
  return resolveTier(
    { roleIds: member.roles.cache.keys(), isOwner: member.guild.ownerId === member.id },
    tierIds,
  );
}

/** The member, or null when they are no longer in the server. */
export function fetchMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  return guild.members.fetch(userId).catch(() => null);
}

/** The member's role ids without @everyone, ready to edit and pass to `roles.set`. */
export function memberRoleIds(member: Pick<GuildMember, 'roles' | 'guild'>): string[] {
  return [...member.roles.cache.keys()].filter((id) => id !== member.guild.id);
}

/** Whether the bot may change the member's nickname: never the owner or anyone above the bot. */
export function canRename(member: Pick<GuildMember, 'id' | 'guild' | 'manageable'>): boolean {
  return member.id !== member.guild.ownerId && member.manageable;
}

/** Builds an Actor from the member's roles as they are right now. */
export async function resolveActor(
  guild: Guild,
  directory: GuildDirectory,
  userId: string,
  source: ActorSource,
  harness?: string,
): Promise<Actor> {
  const member = await fetchMember(guild, userId);
  const tier = member ? memberTier(member, directory) : 'visitor';
  return { userId, tier, source, ...(harness !== undefined && { harness }) };
}
