import type { RoleConfig } from '../config/schema.js';
import type { CharacterProfile } from '../core/game-character.js';
import { registrationNickname, rolesWithClass } from '../core/registration.js';
import type { CommandContext } from './commands/types.js';

/**
 * Registers a member's in-game character when their recruitment application is approved: the
 * class role (replacing any other class), the stored character, and the "⚔️ Nome" nickname.
 * `nicknameSet` is false when Discord won't let the bot rename them (the server owner, or anyone
 * ranked above the bot).
 */
export async function registerCharacter(
  ctx: Pick<CommandContext, 'guild' | 'config' | 'directory' | 'registrations'>,
  userId: string,
  character: CharacterProfile,
  classRole: RoleConfig,
  reason: string,
): Promise<{ nickname: string; nicknameSet: boolean }> {
  const member = await ctx.guild.members.fetch(userId);
  const classId = ctx.directory.roleId(classRole.key);
  const nickname = registrationNickname(classRole.emoji ?? '', character.name);
  if (classId) {
    const classIds = ctx.config
      .get()
      .roles.filter((r) => r.class)
      .map((r) => ctx.directory.roleId(r.key))
      .filter((id): id is string => id !== undefined);
    const current = [...member.roles.cache.keys()].filter((id) => id !== ctx.guild.id);
    await member.roles.set(rolesWithClass(current, classId, classIds), reason);
  }
  ctx.registrations.save({
    userId: member.id,
    characterId: character.id,
    name: character.name,
    serverId: character.serverId,
    classKey: classRole.key,
    legion: character.legion,
    combatPower: character.combatPower,
    itemLevel: character.itemLevel,
  });
  if (member.id === ctx.guild.ownerId || !member.manageable) {
    return { nickname, nicknameSet: false };
  }
  await member.setNickname(nickname, reason);
  return { nickname, nicknameSet: true };
}
