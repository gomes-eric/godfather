import { ChannelType, DiscordAPIError, RESTJSONErrorCodes, type Guild } from 'discord.js';
import type { Logger } from '../logger.js';
import type { VoiceRoomPort } from '../services/voice-port.js';
import { readOverwrites, toDiscordOverwrites } from './overwrites.js';
import { roomPanel } from './room-panel.js';

const RENAME_REPLY_AFTER_MS = 5_000;

export function createDiscordVoicePort(guild: Guild, logger: Logger): VoiceRoomPort {
  const cached = (id: string) => {
    const channel = guild.channels.cache.get(id);
    return channel?.type === ChannelType.GuildVoice ? channel : undefined;
  };
  const voiceChannel = (id: string) => {
    const channel = cached(id);
    if (!channel) throw new Error(`Unknown voice channel ${id}`);
    return channel;
  };

  return {
    everyoneRoleId: guild.roles.everyone.id,

    voiceChannel(id) {
      const channel = cached(id);
      return (
        channel && {
          id: channel.id,
          name: channel.name,
          parentId: channel.parentId,
          position: channel.rawPosition,
          userLimit: channel.userLimit,
          overwrites: readOverwrites(channel),
        }
      );
    },

    members(channelId) {
      return [...(cached(channelId)?.members.values() ?? [])].map((member) => ({
        id: member.id,
        displayName: member.displayName,
        username: member.user.username,
        bot: member.user.bot,
      }));
    },

    voiceChannelOf(userId) {
      return guild.voiceStates.cache.get(userId)?.channelId ?? null;
    },

    async createChannel(spec) {
      const channel = await guild.channels.create({
        name: spec.name,
        type: ChannelType.GuildVoice,
        parent: spec.parentId,
        userLimit: spec.userLimit,
        permissionOverwrites: toDiscordOverwrites(spec.overwrites),
        position: spec.position,
        reason: spec.reason,
      });
      return channel.id;
    },

    async deleteChannelIfExists(id, reason) {
      try {
        await guild.channels.delete(id, reason);
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownChannel) {
          return;
        }
        throw error;
      }
    },

    async moveMember(userId, channelId, reason) {
      const member = await guild.members.fetch(userId);
      await member.voice.setChannel(channelId, reason);
    },

    async disconnectMember(userId, reason) {
      const member = await guild.members.fetch(userId);
      await member.voice.disconnect(reason);
    },

    async setOverwrites(channelId, overwrites) {
      await voiceChannel(channelId).permissionOverwrites.set(toDiscordOverwrites(overwrites));
    },

    async setUserLimit(channelId, limit) {
      await voiceChannel(channelId).setUserLimit(limit);
    },

    // Discord allows 2 renames per channel per 10 minutes, and discord.js waits out the limit in
    // silence.
    async setName(channelId, name) {
      const done = voiceChannel(channelId)
        .setName(name)
        .then(() => 'done' as const);
      done.catch((error: unknown) =>
        logger.warn({ err: error, channelId }, 'temp room rename failed'),
      );
      let timer: NodeJS.Timeout | undefined;
      const slow = new Promise<'queued'>((resolve) => {
        timer = setTimeout(() => resolve('queued'), RENAME_REPLY_AFTER_MS);
      });
      try {
        return await Promise.race([done, slow]);
      } finally {
        clearTimeout(timer);
      }
    },

    async postPanel(channelId, view) {
      return (await voiceChannel(channelId).send(roomPanel(view))).id;
    },

    async editPanel(channelId, messageId, view) {
      const message = await voiceChannel(channelId).messages.fetch(messageId);
      await message.edit(roomPanel(view));
    },
  };
}
