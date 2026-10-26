import type { GuildMember } from 'discord.js';
import type { RoleConfig } from '../config/schema.js';
import type { CharacterProfile } from '../core/game-character.js';
import { NICKNAME_MAX, registrationNickname, rolesWithClass } from '../core/registration.js';
import type { CharacterStore } from '../db/characters.js';
import type { GuildDirectory } from './directory.js';
import { canRename, memberRoleIds } from './members.js';

/**
 * Makes the member look like their character: the class role (replacing any other class) and the
 * "⚔️ Nome" nickname. Returns the nickname, or null when Discord won't let the bot rename them
 * (the server owner, or anyone ranked above the bot).
 */
export async function applyCharacter(
  member: GuildMember,
  directory: GuildDirectory,
  character: { name: string; classRole: RoleConfig },
  reason: string,
): Promise<string | null> {
  const { name, classRole } = character;
  const classId = directory.roleId(classRole.key);
  if (classId) {
    await member.roles.set(
      rolesWithClass(memberRoleIds(member), classId, directory.classRoleIds()),
      reason,
    );
  }
  const nickname = registrationNickname(classRole.emoji ?? '', name);
  if (!canRename(member) || nickname.length > NICKNAME_MAX) return null;
  await member.setNickname(nickname, reason);
  return nickname;
}

/**
 * Registers a member's in-game character when their recruitment application is approved: applies
 * the class role and nickname, and stores the character for /perfil and the daily check.
 */
export async function registerCharacter(
  deps: { directory: GuildDirectory; registrations: CharacterStore },
  member: GuildMember,
  character: CharacterProfile,
  classRole: RoleConfig,
  reason: string,
): Promise<string | null> {
  const nickname = await applyCharacter(
    member,
    deps.directory,
    { name: character.name, classRole },
    reason,
  );
  deps.registrations.save({
    userId: member.id,
    characterId: character.id,
    name: character.name,
    serverId: character.serverId,
    classKey: classRole.key,
    legion: character.legion,
    combatPower: character.combatPower,
    itemLevel: character.itemLevel,
  });
  return nickname;
}
