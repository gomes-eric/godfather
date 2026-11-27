import {
  ChannelType,
  EmbedBuilder,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type MessageMentionOptions,
  type Role,
} from 'discord.js';
import type {
  ChannelView,
  GuildAdminPort,
  MemberView,
  RoleFields,
  RoleView,
} from '../services/guild-admin-port.js';
import { COLORS } from './colors.js';
import { kindOf } from './guild-port.js';
import { fetchMember } from './members.js';

function memberView(member: GuildMember): MemberView {
  return {
    id: member.id,
    username: member.user.username,
    displayName: member.displayName,
    globalName: member.user.globalName,
    nickname: member.nickname,
    bot: member.user.bot,
    roleIds: [...member.roles.cache.keys()],
    kickable: member.kickable,
    bannable: member.bannable,
    moderatable: member.moderatable,
  };
}

function roleView(role: Role): RoleView {
  return {
    id: role.id,
    name: role.name,
    position: role.position,
    managed: role.managed,
    memberCount: role.members.size,
  };
}

function channelView(channel: GuildBasedChannel): ChannelView {
  return {
    id: channel.id,
    name: channel.name,
    kind: kindOf(channel.type),
    parentId: channel.parentId,
    hasTopic: 'topic' in channel,
    messageable: channel.isTextBased() && 'send' in channel && 'bulkDelete' in channel,
  };
}

function roleOptions(fields: RoleFields) {
  return {
    ...(fields.name !== undefined && { name: fields.name }),
    ...(fields.color !== undefined && { colors: { primaryColor: fields.color } }),
    ...(fields.hoist !== undefined && { hoist: fields.hoist }),
    ...(fields.mentionable !== undefined && { mentionable: fields.mentionable }),
  };
}

export function createDiscordGuildAdmin(guild: Guild): GuildAdminPort {
  const textChannel = async (id: string) => {
    const channel = await guild.channels.fetch(id);
    if (!channel?.isTextBased() || !('send' in channel) || !('bulkDelete' in channel)) {
      throw new Error(`Channel ${id} takes no messages`);
    }
    return channel;
  };

  return {
    ownerId: () => guild.ownerId,
    botTopRolePosition: () => guild.members.me?.roles.highest.position ?? null,

    members: () => [...guild.members.cache.values()].map(memberView),

    async fetchMember(userId) {
      const member = await fetchMember(guild, userId);
      return member && memberView(member);
    },

    async fetchUser(userId) {
      const user = await guild.client.users.fetch(userId).catch(() => null);
      return user && { id: user.id, username: user.username, bot: user.bot };
    },

    async kick(userId, reason) {
      await guild.members.kick(userId, reason);
    },

    async ban(userId, reason, deleteMessageSeconds) {
      await guild.bans.create(userId, { reason, deleteMessageSeconds });
    },

    async fetchBan(userId) {
      const ban = await guild.bans.fetch({ user: userId, force: true }).catch(() => null);
      return ban && { id: ban.user.id, username: ban.user.username, bot: ban.user.bot };
    },

    async unban(userId, reason) {
      await guild.bans.remove(userId, reason);
    },

    async timeout(userId, durationMs, reason) {
      await (await guild.members.fetch(userId)).timeout(durationMs, reason);
    },

    roles: () => [...guild.roles.cache.values()].filter((r) => r.id !== guild.id).map(roleView),

    async createRole(fields) {
      return roleView(await guild.roles.create({ ...roleOptions(fields), permissions: [] }));
    },

    async editRole(roleId, fields) {
      await guild.roles.edit(roleId, roleOptions(fields));
    },

    async deleteRole(roleId) {
      await guild.roles.delete(roleId);
    },

    async addRole(userId, roleId) {
      await guild.members.addRole({ user: userId, role: roleId });
    },

    async removeRole(userId, roleId) {
      await guild.members.removeRole({ user: userId, role: roleId });
    },

    channels: () => [...guild.channels.cache.values()].map(channelView),

    async fetchChannel(channelId) {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      return channel && channelView(channel);
    },

    async createChannel(spec) {
      const channel = await guild.channels.create({
        name: spec.name,
        type: spec.kind === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
        ...(spec.parentId && { parent: spec.parentId }),
        ...(spec.topic !== undefined && { topic: spec.topic }),
        ...(spec.userLimit !== undefined && { userLimit: spec.userLimit }),
      });
      return channelView(channel);
    },

    async editChannel(channelId, fields) {
      await guild.channels.edit(channelId, fields);
    },

    async deleteChannel(channelId) {
      await guild.channels.delete(channelId);
    },

    async newestMessages(channelId, limit) {
      const messages = await (await textChannel(channelId)).messages.fetch({ limit });
      return [...messages.values()].map((m) => ({
        id: m.id,
        authorId: m.author.id,
        authorName: m.member?.displayName ?? m.author.username,
        content: m.content,
        createdAt: m.createdAt,
      }));
    },

    async bulkDelete(channelId, messageIds) {
      // filterOld: Discord rejects the whole call if any message is older than 14 days.
      const deleted = await (await textChannel(channelId)).bulkDelete(messageIds, true);
      return deleted.size;
    },

    async send(channelId, message) {
      const allowedMentions: MessageMentionOptions = {
        parse: message.allowMentions ? ['everyone', 'roles', 'users'] : [],
      };
      const channel = await textChannel(channelId);
      if ('embed' in message) {
        const embed = new EmbedBuilder()
          .setDescription(message.embed.description)
          .setColor(COLORS.brand);
        if (message.embed.title) embed.setTitle(message.embed.title);
        await channel.send({ embeds: [embed], allowedMentions });
      } else {
        await channel.send({ content: message.content, allowedMentions });
      }
    },
  };
}
