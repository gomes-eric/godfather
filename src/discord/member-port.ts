import type { Guild, GuildMember } from 'discord.js';
import type { MemberPort, MemberSnapshot } from '../services/member-port.js';

export function memberSnapshot(member: GuildMember): MemberSnapshot {
  return {
    id: member.id,
    displayName: member.displayName,
    roleIds: [...member.roles.cache.keys()].filter((id) => id !== member.guild.id),
    isBot: member.user.bot,
    isOwner: member.guild.ownerId === member.id,
    manageable: member.manageable,
    avatarUrl: member.displayAvatarURL(),
    joinedAt: member.joinedAt,
    createdAt: member.user.createdAt,
    timeoutUntil: member.isCommunicationDisabled() ? member.communicationDisabledUntil : null,
  };
}

export function createDiscordMemberPort(guild: Guild): MemberPort {
  return {
    ownerId: () => guild.ownerId,
    async member(userId) {
      // force: an edit only updates discord.js's cache when the gateway event arrives later.
      const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
      return member ? memberSnapshot(member) : null;
    },
    roleMemberCount: (roleId) => guild.roles.cache.get(roleId)?.members.size ?? 0,
    cachedName: (userId) => guild.members.cache.get(userId)?.displayName,
    async update(userId, change, reason) {
      await guild.members.edit(userId, {
        roles: change.roleIds,
        ...(change.nickname !== undefined && { nick: change.nickname }),
        reason,
      });
    },
  };
}
