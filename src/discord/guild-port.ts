import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelFlags,
  ChannelType,
  EmbedBuilder,
  GuildExplicitContentFilter,
  GuildFeature,
  GuildVerificationLevel,
  OverwriteType,
  type Guild,
  type GuildBasedChannel,
  type GuildChannelCreateOptions,
  type GuildChannelEditOptions,
} from 'discord.js';
import type { ChannelKind } from '../config/schema.js';
import type { ChannelSnapshot, GuildSnapshot, SnapshotChannelKind } from '../setup/model.js';
import type {
  ChannelPosition,
  ChannelSpec,
  ConcreteOverwrite,
  GuildPort,
  PanelMessage,
  RoleSpec,
} from '../setup/port.js';

const KIND_TO_TYPE = {
  category: ChannelType.GuildCategory,
  text: ChannelType.GuildText,
  announcement: ChannelType.GuildAnnouncement,
  voice: ChannelType.GuildVoice,
  forum: ChannelType.GuildForum,
} as const satisfies Record<ChannelKind | 'category', ChannelType>;

function kindOf(type: ChannelType): SnapshotChannelKind {
  const entry = Object.entries(KIND_TO_TYPE).find(([, t]) => t === type);
  return (entry?.[0] as SnapshotChannelKind | undefined) ?? 'other';
}

function toDiscordOverwrites(overwrites: ConcreteOverwrite[]) {
  return overwrites.map((o) => ({
    id: o.id,
    type: o.type === 'member' ? OverwriteType.Member : OverwriteType.Role,
    allow: o.allow,
    deny: o.deny,
  }));
}

function toDiscordTags(spec: ChannelSpec) {
  return spec.tags.map((tag) => ({
    ...(tag.id && { id: tag.id }),
    name: tag.name,
    emoji: tag.emoji ? { id: null, name: tag.emoji } : null,
  }));
}

function snapshotChannel(channel: GuildBasedChannel): ChannelSnapshot {
  const kind = kindOf(channel.type);
  return {
    id: channel.id,
    name: channel.name,
    kind,
    parentId: channel.parentId,
    position: 'rawPosition' in channel ? channel.rawPosition : 0,
    topic: 'topic' in channel ? (channel.topic ?? null) : null,
    userLimit: channel.type === ChannelType.GuildVoice ? channel.userLimit : 0,
    overwrites:
      'permissionOverwrites' in channel
        ? channel.permissionOverwrites.cache.map((o) => ({
            id: o.id,
            type: o.type === OverwriteType.Member ? ('member' as const) : ('role' as const),
            allow: o.allow.bitfield,
            deny: o.deny.bitfield,
          }))
        : [],
    tags:
      channel.type === ChannelType.GuildForum
        ? channel.availableTags.map((t) => ({
            id: t.id,
            name: t.name,
            emoji: t.emoji?.name ?? null,
          }))
        : [],
    requireTag:
      channel.type === ChannelType.GuildForum && channel.flags.has(ChannelFlags.RequireTag),
  };
}

function panelPayload(panel: PanelMessage) {
  const embed = new EmbedBuilder().setDescription(panel.description).setColor(panel.color);
  if (panel.title) embed.setTitle(panel.title);

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < panel.buttons.length; i += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        panel.buttons.slice(i, i + 5).map((button) => {
          const builder = new ButtonBuilder()
            .setCustomId(button.customId)
            .setLabel(button.label)
            .setStyle(ButtonStyle.Secondary);
          if (button.emoji) builder.setEmoji(button.emoji);
          return builder;
        }),
      ),
    );
  }
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

/** GuildPort backed by discord.js. */
export function createDiscordGuildPort(guild: Guild): GuildPort {
  const textChannel = async (id: string) => {
    const channel = await guild.channels.fetch(id);
    if (!channel?.isTextBased()) throw new Error(`Channel ${id} is not a text channel`);
    return channel;
  };

  return {
    async snapshot(messages) {
      await guild.fetch();
      const [roles, channels, me] = await Promise.all([
        guild.roles.fetch(),
        guild.channels.fetch(),
        guild.members.fetchMe(),
      ]);

      const existingMessageIds = new Set<string>();
      await Promise.all(
        messages.map(async ({ channelId, messageId }) => {
          const channel = channels.get(channelId);
          if (!channel?.isTextBased()) return;
          const found = await channel.messages.fetch(messageId).catch(() => null);
          if (found) existingMessageIds.add(messageId);
        }),
      );

      const snapshot: GuildSnapshot = {
        everyoneRoleId: guild.roles.everyone.id,
        botRolePosition: me.roles.highest.position,
        roles: roles.map((role) => ({
          id: role.id,
          name: role.name,
          color: role.colors.primaryColor,
          hoist: role.hoist,
          mentionable: role.mentionable,
          permissions: role.permissions.bitfield,
          position: role.position,
          integration: role.managed,
        })),
        channels: [...channels.values()]
          .filter((c): c is GuildBasedChannel & NonNullable<typeof c> => c !== null)
          .map(snapshotChannel),
        community: guild.features.includes(GuildFeature.Community),
        rulesChannelId: guild.rulesChannelId,
        publicUpdatesChannelId: guild.publicUpdatesChannelId,
        afkChannelId: guild.afkChannelId,
        afkTimeout: guild.afkTimeout,
        existingMessageIds,
      };
      return snapshot;
    },

    async createRole(spec: RoleSpec) {
      const role = await guild.roles.create({
        name: spec.name,
        colors: { primaryColor: spec.color },
        hoist: spec.hoist,
        mentionable: spec.mentionable,
        permissions: spec.permissions,
      });
      return role.id;
    },

    async editRole(id, spec) {
      await guild.roles.edit(id, {
        name: spec.name,
        colors: { primaryColor: spec.color },
        hoist: spec.hoist,
        mentionable: spec.mentionable,
        permissions: spec.permissions,
      });
    },

    async deleteRole(id) {
      await guild.roles.delete(id);
    },

    async setRolePositions(idsTopToBottom) {
      // New roles all share position 1, so positions aren't contiguous and can't be computed
      // from a count. Send the complete order instead (as discord.js's own setPosition does):
      // the given roles at the bottom, every other role keeping its relative order above them.
      const roles = await guild.roles.fetch();
      const moving = new Set(idsTopToBottom);
      const others = [...roles.values()]
        .filter((r) => r.id !== guild.roles.everyone.id && !moving.has(r.id))
        .sort((a, b) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
        .map((r) => r.id);
      const bottomUp = [...[...idsTopToBottom].reverse(), ...others];
      await guild.roles.setPositions(
        bottomUp.map((id, index) => ({ role: id, position: index + 1 })),
      );
    },

    async createChannel(spec) {
      const options = {
        name: spec.name,
        type: KIND_TO_TYPE[spec.kind],
        permissionOverwrites: toDiscordOverwrites(spec.overwrites),
        ...(spec.parentId && spec.kind !== 'category' && { parent: spec.parentId }),
        ...(spec.topic !== null && spec.kind !== 'voice' && { topic: spec.topic }),
        ...(spec.kind === 'voice' && { userLimit: spec.userLimit }),
        ...(spec.kind === 'forum' && { availableTags: toDiscordTags(spec) }),
      } as GuildChannelCreateOptions;
      // The options are built dynamically, so widen the inferred TextChannel result.
      const channel = (await guild.channels.create(options)) as GuildBasedChannel;
      if (spec.kind === 'forum' && spec.requireTag && channel.type === ChannelType.GuildForum) {
        await channel.edit({ flags: [ChannelFlags.RequireTag] });
      }
      return channel.id;
    },

    async editChannel(id, spec) {
      const channel = await guild.channels.fetch(id);
      if (!channel) throw new Error(`Unknown channel ${id}`);
      const options = {
        name: spec.name,
        permissionOverwrites: toDiscordOverwrites(spec.overwrites),
        ...(spec.kind !== 'category' && { parent: spec.parentId, lockPermissions: false }),
        ...(spec.kind !== 'voice' && spec.kind !== 'category' && { topic: spec.topic }),
        ...(spec.kind === 'voice' && { userLimit: spec.userLimit }),
        ...(spec.kind === 'forum' && {
          availableTags: toDiscordTags(spec),
          flags: spec.requireTag ? [ChannelFlags.RequireTag] : [],
        }),
      } as GuildChannelEditOptions;
      await channel.edit(options);
    },

    async deleteChannel(id) {
      await guild.channels.delete(id);
    },

    async setChannelPositions(positions: ChannelPosition[]) {
      // Discord rejects a bulk update that changes more than one channel's parent, so moves
      // between categories go one by one and the bulk call only sets positions.
      const channels = await guild.channels.fetch();
      for (const p of positions) {
        const channel = channels.get(p.id);
        if (p.parentId && channel && channel.parentId !== p.parentId && 'setParent' in channel) {
          await channel.setParent(p.parentId, { lockPermissions: false });
        }
      }
      await guild.channels.setPositions(
        positions.map((p) => ({ channel: p.id, position: p.position })),
      );
    },

    async enableCommunity(rulesChannelId, updatesChannelId) {
      await guild.edit({
        features: [...guild.features, GuildFeature.Community],
        rulesChannel: rulesChannelId,
        publicUpdatesChannel: updatesChannelId,
        verificationLevel: Math.max(guild.verificationLevel, GuildVerificationLevel.Low),
        explicitContentFilter: GuildExplicitContentFilter.AllMembers,
      });
    },

    async setCommunityChannels(rulesChannelId, updatesChannelId) {
      await guild.edit({ rulesChannel: rulesChannelId, publicUpdatesChannel: updatesChannelId });
    },

    async setAfk(channelId, timeoutSeconds) {
      await guild.edit({ afkChannel: channelId, afkTimeout: timeoutSeconds });
    },

    async upsertPanel(channelId, messageId, panel) {
      const channel = await textChannel(channelId);
      const payload = panelPayload(panel);
      if (messageId) {
        const existing = await channel.messages.fetch(messageId).catch(() => null);
        if (existing) {
          await existing.edit(payload);
          return existing.id;
        }
      }
      if (!('send' in channel)) throw new Error(`Cannot post in channel ${channelId}`);
      const sent = await channel.send(payload);
      return sent.id;
    },
  };
}
