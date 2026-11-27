import {
  ChannelType,
  type Guild,
  type GuildMember,
  type VoiceChannel,
  type VoiceState,
} from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { RateLimiter } from '../core/rate-limit.js';
import { tierAtLeast } from '../core/tiers.js';
import {
  accessOverwrites,
  banFromRoom,
  lowestFreeNumber,
  nextRenameAt,
  RENAME_LIMIT,
  RoomAllocator,
  roomName,
  roomOverwrites,
  transferOwnership,
  type RoomAccess,
} from '../core/voice-rooms.js';
import type { ManagedObjectStore } from '../db/managed-objects.js';
import type { TempRoom, TempVoiceStore } from '../db/temp-voice.js';
import { readOverwrites, toDiscordOverwrites } from '../discord/overwrites.js';
import { roomPanel, type RoomPanelView } from '../discord/room-panel.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';

const t = ptBR.voice;
const CREATION_WINDOW_MS = 60_000;
const GUILD_KEY = 'guild';
const RENAME_REPLY_AFTER_MS = 5_000;

type Generator = { key: string; nameTemplate: string; userLimit: number };

export type RoomCommand =
  | { type: 'rename'; name: string }
  | { type: 'limit'; limit: number }
  | { type: 'lock' }
  | { type: 'unlock' }
  | { type: 'hide' }
  | { type: 'unhide' }
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

function nextAccess(current: RoomAccess, type: 'lock' | 'unlock' | 'hide' | 'unhide'): RoomAccess {
  switch (type) {
    case 'lock':
      return { ...current, locked: true };
    case 'unlock':
      return { ...current, locked: false };
    case 'hide':
      return { ...current, hidden: true };
    case 'unhide':
      return { ...current, hidden: false };
  }
}

export class VoiceService {
  private readonly allocator = new RoomAllocator();
  private creationLimit: { limit: number; limiter: RateLimiter } | undefined;
  /** When the bot renamed each room recently, to stay inside Discord's 2-per-10-minutes limit. */
  private readonly renames = new Map<string, number[]>();

  constructor(private readonly deps: Deps) {}

  private allowCreation(): boolean {
    const limit = this.deps.config.get().settings.voiceRooms.maxCreationsPerMinute;
    if (limit <= 0) return true;
    if (this.creationLimit?.limit !== limit) {
      this.creationLimit = { limit, limiter: new RateLimiter(limit, CREATION_WINDOW_MS) };
    }
    return this.creationLimit.limiter.take(GUILD_KEY);
  }

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
        await this.createRoom(newState.member, generator, newState.channelId);
      }
    }
  }

  private async createRoom(
    member: GuildMember,
    generator: Generator,
    generatorChannelId: string,
  ): Promise<void> {
    const { guild, rooms, logger } = this.deps;
    if (!this.allowCreation()) {
      logger.warn({ member: member.user.tag }, 'voice room creation throttled for the guild');
      return;
    }

    const generatorChannel = this.voiceChannel(generatorChannelId);
    if (!generatorChannel) return;

    const room = await this.allocator.run(generator.key, async () => {
      const used = rooms.numbersFor(generator.key);
      const n = lowestFreeNumber(used);
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
        permissionOverwrites: toDiscordOverwrites(
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
      await this.deleteIfEmpty(room.id);
      return;
    }
    await this.postPanel(room.id);
  }

  private panelView(room: TempRoom, channel: VoiceChannel): RoomPanelView {
    return {
      roomId: room.channelId,
      ownerId: room.ownerId,
      locked: room.locked,
      hidden: room.hidden,
      userLimit: channel.userLimit,
    };
  }

  private async postPanel(channelId: string): Promise<void> {
    const room = this.deps.rooms.get(channelId);
    const channel = this.voiceChannel(channelId);
    if (!room || !channel) return;
    try {
      const message = await channel.send(roomPanel(this.panelView(room, channel)));
      this.deps.rooms.setPanelMessage(channelId, message.id);
    } catch (error) {
      this.deps.logger.warn({ err: error, channelId }, 'could not post the room panel');
    }
  }

  private async refreshPanel(channelId: string): Promise<void> {
    const room = this.deps.rooms.get(channelId);
    const channel = this.voiceChannel(channelId);
    if (!room || !channel) return;
    if (!room.panelMessageId) return this.postPanel(channelId);
    try {
      const message = await channel.messages.fetch(room.panelMessageId);
      await message.edit(roomPanel(this.panelView(room, channel)));
    } catch {
      await this.postPanel(channelId);
    }
  }

  async deleteIfEmpty(channelId: string): Promise<void> {
    const { rooms, logger } = this.deps;
    const room = rooms.get(channelId);
    if (!room) return;

    const channel = this.voiceChannel(channelId);
    if (channel && channel.members.size > 0) return;

    rooms.delete(channelId);
    this.renames.delete(channelId);
    if (!channel) return;
    await channel
      .delete('Temp room is empty')
      .catch((error: unknown) =>
        logger.warn({ err: error, channelId }, 'failed to delete empty temp room'),
      );
  }

  async sweep(): Promise<{ removed: number; created: number }> {
    let removed = 0;
    for (const room of this.deps.rooms.all()) {
      await this.deleteIfEmpty(room.channelId);
      const after = this.deps.rooms.get(room.channelId);
      if (!after) removed++;
      else if (!after.panelMessageId) await this.postPanel(room.channelId);
    }

    let created = 0;
    for (const [channelId, generator] of this.generators()) {
      const channel = this.voiceChannel(channelId);
      for (const member of channel?.members.values() ?? []) {
        if (member.user.bot) continue;
        await this.createRoom(member, generator, channelId);
        created++;
      }
    }
    return { removed, created };
  }

  refusal(actor: Actor, channelId: string | null, type: RoomCommand['type']): string | undefined {
    const found = this.roomAndChannel(channelId);
    if (!found) return t.notInRoom;
    const { room, channel } = found;

    const isOwner = room.ownerId === actor.userId;
    const isOfficer = tierAtLeast(actor.tier, 'officer');
    if (type === 'claim') {
      if (isOwner) return t.alreadyOwner;
      if (channel.members.has(room.ownerId) && !isOfficer) return t.ownerPresent;
      return undefined;
    }
    if (!isOwner && !isOfficer) return t.notOwner;
    if (type === 'rename') {
      const now = Date.now();
      const at = nextRenameAt(this.renames.get(room.channelId) ?? [], now);
      if (at > now) return t.renameLimited(new Date(at));
    }
    return undefined;
  }

  private roomAndChannel(channelId: string | null) {
    const room = channelId ? this.deps.rooms.get(channelId) : undefined;
    const channel = room && this.voiceChannel(room.channelId);
    return room && channel ? { room, channel } : undefined;
  }

  occupants(channelId: string, exceptUserId: string): GuildMember[] {
    const channel = this.roomAndChannel(channelId)?.channel;
    return [...(channel?.members.values() ?? [])].filter(
      (member) => member.id !== exceptUserId && !member.user.bot,
    );
  }

  async manage(
    actor: Actor,
    channelId: string | null,
    command: RoomCommand,
  ): Promise<ServiceOutcome<string>> {
    const refusal = this.refusal(actor, channelId, command.type);
    if (refusal) return rejected(refusal);
    const { room, channel } = this.roomAndChannel(channelId)!;

    if (command.type === 'rename') {
      const name = command.name.trim();
      if (name.length === 0 || name.length > 100) return rejected(t.nameInvalid);
      command = { type: 'rename', name };
    }
    if (
      command.type === 'limit' &&
      !(Number.isInteger(command.limit) && command.limit >= 0 && command.limit <= 99)
    ) {
      return rejected(t.limitInvalid);
    }
    if (command.type === 'kick') {
      if (command.userId === actor.userId) return rejected(t.cannotKickSelf);
      if (!channel.members.has(command.userId)) return rejected(t.notInThisRoom);
    }

    const isOwner = room.ownerId === actor.userId;
    const ownAction = isOwner || (command.type === 'claim' && !channel.members.has(room.ownerId));
    const finalCommand = command;
    return this.deps.runAction({
      actor,
      action: ownAction ? 'voice.own.manage' : 'voice.temp.manage',
      target: channel.name,
      params: { channelId: channel.id, ...finalCommand },
      preview: `${finalCommand.type} ${channel.name}`,
      execute: () => this.apply(room, channel, actor, finalCommand),
    });
  }

  private async apply(
    room: TempRoom,
    channel: VoiceChannel,
    actor: Actor,
    command: RoomCommand,
  ): Promise<string> {
    switch (command.type) {
      case 'rename':
        return this.rename(channel, command.name);
      case 'limit':
        await channel.setUserLimit(command.limit);
        await this.refreshPanel(room.channelId);
        return t.limited(command.limit);
      case 'lock':
      case 'unlock':
      case 'hide':
      case 'unhide':
        await this.setAccess(room, channel, nextAccess(room, command.type));
        await this.refreshPanel(room.channelId);
        return { lock: t.locked, unlock: t.unlocked, hide: t.hidden, unhide: t.unhidden }[
          command.type
        ];
      case 'kick': {
        const member = channel.members.get(command.userId);
        await channel.permissionOverwrites.set(
          toDiscordOverwrites(banFromRoom(readOverwrites(channel), command.userId)),
        );
        await member?.voice.disconnect('Kicked from temp room');
        return t.kicked(member?.displayName ?? command.userId);
      }
      case 'claim':
        await channel.permissionOverwrites.set(
          toDiscordOverwrites(
            transferOwnership(readOverwrites(channel), room.ownerId, actor.userId),
          ),
        );
        this.deps.rooms.setOwner(room.channelId, actor.userId);
        await this.refreshPanel(room.channelId);
        return t.claimed;
    }
  }

  private async setAccess(room: TempRoom, channel: VoiceChannel, access: RoomAccess) {
    const generatorId = this.deps.managed.get('channel', room.generatorKey)?.discordId;
    const generator = generatorId ? this.voiceChannel(generatorId) : undefined;
    await channel.permissionOverwrites.set(
      toDiscordOverwrites(
        accessOverwrites(
          readOverwrites(channel),
          generator ? readOverwrites(generator) : [],
          this.deps.guild.roles.everyone.id,
          access,
          channel.members.keys(),
        ),
      ),
    );
    this.deps.rooms.setAccess(room.channelId, access);
  }

  /**
   * Discord allows 2 renames per channel per 10 minutes, and discord.js waits out the limit in
   * silence. refusal() keeps the bot's own renames inside it; if Discord still holds one (renames
   * made in Discord itself count too), the reply says it is queued instead of hanging.
   */
  private async rename(channel: VoiceChannel, name: string): Promise<string> {
    const history = this.renames.get(channel.id) ?? [];
    this.renames.set(channel.id, [...history, Date.now()].slice(-RENAME_LIMIT));

    const done = channel.setName(name).then(() => 'done' as const);
    done.catch((error: unknown) =>
      this.deps.logger.warn({ err: error, channelId: channel.id }, 'temp room rename failed'),
    );
    let timer: NodeJS.Timeout | undefined;
    const slow = new Promise<'slow'>((resolve) => {
      timer = setTimeout(() => resolve('slow'), RENAME_REPLY_AFTER_MS);
    });
    try {
      return (await Promise.race([done, slow])) === 'done' ? t.renamed(name) : t.renameQueued(name);
    } finally {
      clearTimeout(timer);
    }
  }
}
