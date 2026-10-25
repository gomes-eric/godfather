import {
  ChannelType,
  OverwriteType,
  type Guild,
  type GuildMember,
  type VoiceBasedChannel,
  type VoiceChannel,
  type VoiceState,
} from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { tierAtLeast } from '../core/tiers.js';
import {
  banFromRoom,
  lockOverwrites,
  lowestFreeNumber,
  RoomAllocator,
  roomName,
  roomOverwrites,
  transferOwnership,
  unlockOverwrites,
  type RoleOverwrite,
} from '../core/voice-rooms.js';
import type { ManagedObjectStore } from '../db/managed-objects.js';
import type { TempRoom, TempVoiceStore } from '../db/temp-voice.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';

const t = ptBR.voice;
const CREATE_COOLDOWN_MS = 10_000;

type Generator = { key: string; nameTemplate: string; userLimit: number };

export type RoomCommand =
  | { type: 'rename'; name: string }
  | { type: 'limit'; limit: number }
  | { type: 'lock' }
  | { type: 'unlock' }
  | { type: 'kick'; userId: string }
  | { type: 'claim' };

interface Deps {
  guild: Guild;
  config: ConfigStore;
  managed: ManagedObjectStore;
  rooms: TempVoiceStore;
  runAction: ActionRunner;
  logger: Logger;
}

function readOverwrites(channel: VoiceBasedChannel): RoleOverwrite[] {
  return channel.permissionOverwrites.cache.map((o) => ({
    id: o.id,
    type: o.type === OverwriteType.Member ? ('member' as const) : ('role' as const),
    allow: o.allow.bitfield,
    deny: o.deny.bitfield,
  }));
}

function toDiscord(overwrites: RoleOverwrite[]) {
  return overwrites.map((o) => ({
    id: o.id,
    type: o.type === 'member' ? OverwriteType.Member : OverwriteType.Role,
    allow: o.allow,
    deny: o.deny,
  }));
}

/** Join-to-create voice rooms (PLAN.md §6.6). */
export class VoiceService {
  private readonly allocator = new RoomAllocator();
  private readonly lastCreated = new Map<string, number>();

  constructor(private readonly deps: Deps) {}

  /** Generator channel id → generator config, for the generators /setup created. */
  private generators(): Map<string, Generator> {
    const map = new Map<string, Generator>();
    for (const generator of this.deps.config.get().voiceGenerators) {
      const id = this.deps.managed.get('channel', generator.key)?.discordId;
      if (id) map.set(id, generator);
    }
    return map;
  }

  private voiceChannel(id: string): VoiceChannel | undefined {
    const channel = this.deps.guild.channels.cache.get(id);
    return channel?.type === ChannelType.GuildVoice ? channel : undefined;
  }

  async onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      await this.deleteIfEmpty(oldState.channelId);
    }
    if (newState.channelId && newState.channelId !== oldState.channelId && newState.member) {
      const generator = this.generators().get(newState.channelId);
      if (generator && !newState.member.user.bot) {
        await this.createRoom(newState.member, generator, newState.channelId, true);
      }
    }
  }

  private async createRoom(
    member: GuildMember,
    generator: Generator,
    generatorChannelId: string,
    enforceCooldown: boolean,
  ): Promise<void> {
    const { guild, rooms, logger } = this.deps;
    const now = Date.now();
    if (enforceCooldown && now - (this.lastCreated.get(member.id) ?? 0) < CREATE_COOLDOWN_MS) {
      await member.voice.disconnect('Room creation cooldown').catch(() => undefined);
      await member.send(t.cooldown).catch(() => undefined);
      return;
    }
    this.lastCreated.set(member.id, now);

    const generatorChannel = this.voiceChannel(generatorChannelId);
    if (!generatorChannel) return;

    const room = await this.allocator.run(generator.key, async () => {
      const used = rooms.numbersFor(generator.key);
      const n = lowestFreeNumber(used);
      // Sit right below the previous number (or the generator) so rooms stay in order.
      const previous = rooms
        .all()
        .filter((r) => r.generatorKey === generator.key && r.number < n)
        .sort((a, b) => b.number - a.number)
        .map((r) => this.voiceChannel(r.channelId))
        .find((c) => c !== undefined);

      const channel = await guild.channels.create({
        name: roomName(generator.nameTemplate, n),
        type: ChannelType.GuildVoice,
        parent: generatorChannel.parentId,
        userLimit: generator.userLimit,
        permissionOverwrites: toDiscord(
          roomOverwrites(readOverwrites(generatorChannel), member.id),
        ),
        position: (previous ?? generatorChannel).rawPosition + 1,
        reason: `Temp room for ${member.user.tag}`,
      });
      rooms.insert({
        channelId: channel.id,
        generatorKey: generator.key,
        number: n,
        ownerId: member.id,
      });
      return channel;
    });

    try {
      await member.voice.setChannel(room, 'Moved to their new room');
      logger.info({ room: room.name, owner: member.user.tag }, 'temp voice room created');
    } catch {
      // They left the generator before the move; don't leave an empty room behind.
      await this.deleteIfEmpty(room.id);
    }
  }

  async deleteIfEmpty(channelId: string): Promise<void> {
    const { rooms, logger } = this.deps;
    const room = rooms.get(channelId);
    if (!room) return;

    const channel = this.voiceChannel(channelId);
    if (!channel) {
      rooms.delete(channelId);
      return;
    }
    if (channel.members.size > 0) return;

    rooms.delete(channelId);
    await channel
      .delete('Temp room is empty')
      .catch((error: unknown) =>
        logger.warn({ err: error, channelId }, 'failed to delete empty temp room'),
      );
  }

  /** On startup: drop rooms that emptied while the bot was off, serve anyone waiting in a ➕. */
  async sweep(): Promise<{ removed: number; created: number }> {
    let removed = 0;
    for (const room of this.deps.rooms.all()) {
      const before = this.deps.rooms.get(room.channelId);
      await this.deleteIfEmpty(room.channelId);
      if (before && !this.deps.rooms.get(room.channelId)) removed++;
    }

    let created = 0;
    for (const [channelId, generator] of this.generators()) {
      const channel = this.voiceChannel(channelId);
      for (const member of channel?.members.values() ?? []) {
        if (member.user.bot) continue;
        await this.createRoom(member, generator, channelId, false);
        created++;
      }
    }
    return { removed, created };
  }

  /** Owner (or officer) commands for the room the actor is in. */
  async manage(
    actor: Actor,
    channelId: string | null,
    command: RoomCommand,
  ): Promise<ServiceOutcome<string>> {
    const room = channelId ? this.deps.rooms.get(channelId) : undefined;
    const channel = room && this.voiceChannel(room.channelId);
    if (!room || !channel) return rejected(t.notInRoom);

    const isOwner = room.ownerId === actor.userId;
    const isOfficer = tierAtLeast(actor.tier, 'officer');

    if (command.type === 'claim') {
      if (isOwner) return rejected(t.alreadyOwner);
      if (channel.members.has(room.ownerId) && !isOfficer) return rejected(t.ownerPresent);
    } else if (!isOwner && !isOfficer) {
      return rejected(t.notOwner);
    }
    if (command.type === 'kick') {
      if (command.userId === actor.userId) return rejected(t.cannotKickSelf);
      if (!channel.members.has(command.userId)) return rejected(t.notInThisRoom);
    }

    const ownAction = isOwner || (command.type === 'claim' && !channel.members.has(room.ownerId));
    return this.deps.runAction({
      actor,
      action: ownAction ? 'voice.own.manage' : 'voice.temp.manage',
      target: channel.name,
      params: { channelId: channel.id, ...command },
      preview: `${command.type} ${channel.name}`,
      execute: () => this.apply(room, channel, actor, command),
    });
  }

  private async apply(
    room: TempRoom,
    channel: VoiceChannel,
    actor: Actor,
    command: RoomCommand,
  ): Promise<string> {
    const everyoneId = this.deps.guild.roles.everyone.id;
    switch (command.type) {
      case 'rename':
        await channel.setName(command.name);
        return t.renamed(command.name);
      case 'limit':
        await channel.setUserLimit(command.limit);
        return t.limited(command.limit);
      case 'lock':
        await channel.permissionOverwrites.set(
          toDiscord(lockOverwrites(readOverwrites(channel), everyoneId)),
        );
        return t.locked;
      case 'unlock': {
        const generatorId = this.deps.managed.get('channel', room.generatorKey)?.discordId;
        const generator = generatorId ? this.voiceChannel(generatorId) : undefined;
        const generatorOverwrites = generator ? readOverwrites(generator) : [];
        await channel.permissionOverwrites.set(
          toDiscord(unlockOverwrites(readOverwrites(channel), generatorOverwrites)),
        );
        return t.unlocked;
      }
      case 'kick': {
        const member = channel.members.get(command.userId);
        await channel.permissionOverwrites.set(
          toDiscord(banFromRoom(readOverwrites(channel), command.userId)),
        );
        await member?.voice.disconnect('Kicked from temp room');
        return t.kicked(member?.displayName ?? command.userId);
      }
      case 'claim':
        await channel.permissionOverwrites.set(
          toDiscord(transferOwnership(readOverwrites(channel), room.ownerId, actor.userId)),
        );
        this.deps.rooms.setOwner(room.channelId, actor.userId);
        return t.claimed;
    }
  }
}
