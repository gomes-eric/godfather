import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { authorize, type ActionName } from '../core/permissions.js';
import { RateLimiter } from '../core/rate-limit.js';
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
import type { TempVoiceStore } from '../db/temp-voice.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import type { RoomMember, RoomPanelView, VoiceRoomPort } from './voice-port.js';

const t = ptBR.voice;
const CREATION_WINDOW_MS = 60_000;
const GUILD_KEY = 'guild';
const MAX_NAME_LENGTH = 100;
const MAX_USER_LIMIT = 99;

interface Generator {
  key: string;
  channelId: string;
  nameTemplate: string;
  userLimit: number;
}

export const SIMPLE_ROOM_COMMANDS = ['lock', 'unlock', 'hide', 'unhide', 'claim'] as const;
export type SimpleRoomCommand = (typeof SIMPLE_ROOM_COMMANDS)[number];

export function isSimpleRoomCommand(type: string): type is SimpleRoomCommand {
  return (SIMPLE_ROOM_COMMANDS as readonly string[]).includes(type);
}

export type RoomCommand =
  | { type: 'rename'; name: string }
  | { type: 'limit'; limit: number }
  | { type: 'kick'; userId: string }
  | { type: SimpleRoomCommand };

export interface RoomDescription extends RoomAccess {
  id: string;
  name: string;
  userLimit: number;
  ownerId: string;
  /** Everyone connected, bots included. */
  occupants: RoomMember[];
}

export type RoomCheck =
  { allowed: true; room: RoomDescription } | { allowed: false; reason: string };

type Gate =
  { allowed: true; room: RoomDescription; action: ActionName } | { allowed: false; reason: string };

interface Deps {
  port: VoiceRoomPort;
  config: Pick<ConfigStore, 'get'>;
  managed: Pick<ManagedObjectStore, 'get'>;
  rooms: TempVoiceStore;
  runAction: ActionRunner;
  logger: Logger;
  now?: () => number;
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
  private readonly now: () => number;
  private creationLimit: { limit: number; limiter: RateLimiter } | undefined;
  /** When the bot renamed each room recently, to stay inside Discord's 2-per-10-minutes limit. */
  private readonly renames = new Map<string, number[]>();
  private readonly deleting = new Set<string>();

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now;
  }

  async memberMoved(
    userId: string,
    fromChannelId: string | null,
    toChannelId: string | null,
  ): Promise<void> {
    if (fromChannelId === toChannelId) return;
    if (fromChannelId) await this.deleteIfEmpty(fromChannelId);

    const generator = this.generators().find((g) => g.channelId === toChannelId);
    const member =
      generator && this.deps.port.members(generator.channelId).find((m) => m.id === userId);
    if (generator && member && !member.bot) await this.createRoom(generator, member);
  }

  async sweep(): Promise<{ removed: number; created: number }> {
    const { port, rooms } = this.deps;
    let removed = 0;
    for (const room of rooms.all()) {
      if (await this.deleteIfEmpty(room.channelId)) removed++;
      else if (!rooms.get(room.channelId)?.panelMessageId) await this.postPanel(room.channelId);
    }

    let created = 0;
    for (const generator of this.generators()) {
      for (const member of port.members(generator.channelId)) {
        if (!member.bot && (await this.createRoom(generator, member))) created++;
      }
    }
    return { removed, created };
  }

  roomOf(userId: string): string | null {
    const channelId = this.deps.port.voiceChannelOf(userId);
    return channelId && this.deps.rooms.get(channelId) ? channelId : null;
  }

  describe(roomId: string | null): RoomDescription | undefined {
    const room = roomId ? this.deps.rooms.get(roomId) : undefined;
    const channel = room && this.deps.port.voiceChannel(room.channelId);
    if (!room || !channel) return undefined;
    return {
      id: room.channelId,
      name: channel.name,
      userLimit: channel.userLimit,
      ownerId: room.ownerId,
      locked: room.locked,
      hidden: room.hidden,
      occupants: this.deps.port.members(room.channelId),
    };
  }

  /** The same check manage() runs first, for prompts shown before the command. */
  check(actor: Actor, roomId: string | null, type: RoomCommand['type']): RoomCheck {
    return this.gate(actor, roomId, type);
  }

  async manage(
    actor: Actor,
    roomId: string | null,
    command: RoomCommand,
  ): Promise<ServiceOutcome<string>> {
    const gate = this.gate(actor, roomId, command.type);
    if (!gate.allowed) return rejected(gate.reason);
    const { room, action } = gate;

    const invalid = this.invalid(actor, room, command);
    if (invalid) return rejected(invalid);
    const final = command.type === 'rename' ? { ...command, name: command.name.trim() } : command;

    return this.deps.runAction({
      actor,
      action,
      target: room.name,
      params: { channelId: room.id, ...final },
      preview: `${final.type} ${room.name}`,
      execute: () => this.apply(actor, room, final),
    });
  }

  private gate(actor: Actor, roomId: string | null, type: RoomCommand['type']): Gate {
    const room = this.describe(roomId);
    if (!room) return { allowed: false, reason: t.notInRoom };

    const isOwner = room.ownerId === actor.userId;
    if (type === 'claim' && isOwner) return { allowed: false, reason: t.alreadyOwner };
    const ownerLeft = !room.occupants.some((o) => o.id === room.ownerId);
    const action: ActionName =
      isOwner || (type === 'claim' && ownerLeft) ? 'voice.own.manage' : 'voice.temp.manage';
    if (!authorize(actor.tier, action).allowed) {
      return { allowed: false, reason: type === 'claim' ? t.ownerPresent : t.notOwner };
    }

    if (type === 'rename') {
      const now = this.now();
      const at = nextRenameAt(this.renames.get(room.id) ?? [], now);
      if (at > now) return { allowed: false, reason: t.renameLimited(new Date(at)) };
    }
    return { allowed: true, room, action };
  }

  private invalid(actor: Actor, room: RoomDescription, command: RoomCommand): string | undefined {
    switch (command.type) {
      case 'rename': {
        const length = command.name.trim().length;
        return length === 0 || length > MAX_NAME_LENGTH ? t.nameInvalid : undefined;
      }
      case 'limit':
        return Number.isInteger(command.limit) &&
          command.limit >= 0 &&
          command.limit <= MAX_USER_LIMIT
          ? undefined
          : t.limitInvalid;
      case 'kick':
        if (command.userId === actor.userId) return t.cannotKickSelf;
        return room.occupants.some((o) => o.id === command.userId) ? undefined : t.notInThisRoom;
      default:
        return undefined;
    }
  }

  private async apply(actor: Actor, room: RoomDescription, command: RoomCommand): Promise<string> {
    const { port } = this.deps;
    switch (command.type) {
      case 'rename':
        return this.rename(room.id, command.name);
      case 'limit':
        await port.setUserLimit(room.id, command.limit);
        await this.refreshPanel(room.id);
        return t.limited(command.limit);
      case 'lock':
      case 'unlock':
      case 'hide':
      case 'unhide':
        await this.setAccess(room, nextAccess(room, command.type));
        await this.refreshPanel(room.id);
        return { lock: t.locked, unlock: t.unlocked, hide: t.hidden, unhide: t.unhidden }[
          command.type
        ];
      case 'kick': {
        await port.setOverwrites(room.id, banFromRoom(this.overwrites(room.id), command.userId));
        if (port.members(room.id).some((m) => m.id === command.userId)) {
          await port.moveMember(command.userId, null, 'Kicked from temp room');
        }
        const kicked = room.occupants.find((o) => o.id === command.userId);
        return t.kicked(kicked?.displayName ?? command.userId);
      }
      case 'claim':
        await port.setOverwrites(
          room.id,
          transferOwnership(this.overwrites(room.id), room.ownerId, actor.userId),
        );
        this.deps.rooms.setOwner(room.id, actor.userId);
        await this.refreshPanel(room.id);
        return t.claimed;
    }
  }

  private async rename(roomId: string, name: string): Promise<string> {
    const history = this.renames.get(roomId) ?? [];
    this.renames.set(roomId, [...history, this.now()].slice(-RENAME_LIMIT));
    const result = await this.deps.port.setName(roomId, name);
    return result === 'done' ? t.renamed(name) : t.renameQueued(name);
  }

  private async setAccess(room: RoomDescription, access: RoomAccess): Promise<void> {
    const { port, rooms, managed } = this.deps;
    const generatorKey = rooms.get(room.id)?.generatorKey;
    const generatorId = generatorKey && managed.get('channel', generatorKey)?.discordId;
    const template = generatorId ? this.overwrites(generatorId) : [];
    await port.setOverwrites(
      room.id,
      accessOverwrites(
        this.overwrites(room.id),
        template,
        port.everyoneRoleId,
        access,
        room.occupants.map((o) => o.id),
      ),
    );
    rooms.setAccess(room.id, access);
  }

  private overwrites(channelId: string) {
    return this.deps.port.voiceChannel(channelId)?.overwrites ?? [];
  }

  private generators(): Generator[] {
    return this.deps.config.get().voiceGenerators.flatMap((generator) => {
      const channelId = this.deps.managed.get('channel', generator.key)?.discordId;
      return channelId ? [{ ...generator, channelId }] : [];
    });
  }

  private allowCreation(): boolean {
    const limit = this.deps.config.get().settings.voiceRooms.maxCreationsPerMinute;
    if (limit <= 0) return true;
    if (this.creationLimit?.limit !== limit) {
      this.creationLimit = {
        limit,
        limiter: new RateLimiter(limit, CREATION_WINDOW_MS, this.now),
      };
    }
    return this.creationLimit.limiter.take(GUILD_KEY);
  }

  /** True when the member ended up in a new room of their own. */
  private async createRoom(generator: Generator, member: RoomMember): Promise<boolean> {
    const { port, logger } = this.deps;
    if (!this.allowCreation()) {
      logger.warn({ member: member.username }, 'voice room creation throttled for the guild');
      return false;
    }

    let roomId: string | undefined;
    try {
      roomId = await this.allocator.run(generator.key, () => this.openRoom(generator, member));
    } catch (error) {
      logger.warn({ err: error, generator: generator.key }, 'could not create a temp voice room');
      return false;
    }
    if (!roomId) return false;

    try {
      await port.moveMember(member.id, roomId, 'Moved to their new room');
    } catch {
      await this.deleteIfEmpty(roomId);
      return false;
    }
    logger.info({ roomId, owner: member.username }, 'temp voice room created');
    await this.postPanel(roomId);
    return true;
  }

  private async openRoom(generator: Generator, member: RoomMember): Promise<string | undefined> {
    const { port, rooms, logger } = this.deps;
    const source = port.voiceChannel(generator.channelId);
    if (!source) return undefined;

    const n = lowestFreeNumber(rooms.numbersFor(generator.key));
    const previous = rooms
      .all()
      .filter((r) => r.generatorKey === generator.key && r.number < n)
      .sort((a, b) => b.number - a.number)
      .map((r) => port.voiceChannel(r.channelId))
      .find((c) => c !== undefined);

    const channelId = await port.createChannel({
      name: roomName(generator.nameTemplate, n),
      parentId: source.parentId,
      position: (previous ?? source).position + 1,
      userLimit: generator.userLimit,
      overwrites: roomOverwrites(source.overwrites, member.id),
      reason: `Temp room for ${member.username}`,
    });
    try {
      rooms.insert({ channelId, generatorKey: generator.key, number: n, ownerId: member.id });
    } catch (error) {
      await port
        .deleteChannel(channelId, 'Temp room could not be saved')
        .catch((cleanup: unknown) =>
          logger.warn({ err: cleanup, channelId }, 'could not delete an unsaved temp room'),
        );
      throw error;
    }
    return channelId;
  }

  /** True when the room is gone afterwards. A room whose channel could not be deleted stays. */
  private async deleteIfEmpty(channelId: string): Promise<boolean> {
    const { port, rooms, logger } = this.deps;
    if (!rooms.get(channelId) || this.deleting.has(channelId)) return false;

    if (port.voiceChannel(channelId)) {
      if (port.members(channelId).length > 0) return false;
      this.deleting.add(channelId);
      try {
        await port.deleteChannel(channelId, 'Temp room is empty');
      } catch (error) {
        logger.warn({ err: error, channelId }, 'failed to delete empty temp room');
        return false;
      } finally {
        this.deleting.delete(channelId);
      }
    }
    rooms.delete(channelId);
    this.renames.delete(channelId);
    return true;
  }

  private panelView(roomId: string): RoomPanelView | undefined {
    const room = this.describe(roomId);
    return (
      room && {
        roomId: room.id,
        ownerId: room.ownerId,
        locked: room.locked,
        hidden: room.hidden,
        userLimit: room.userLimit,
      }
    );
  }

  private async postPanel(roomId: string): Promise<void> {
    const view = this.panelView(roomId);
    if (!view) return;
    try {
      this.deps.rooms.setPanelMessage(roomId, await this.deps.port.postPanel(roomId, view));
    } catch (error) {
      this.deps.logger.warn({ err: error, channelId: roomId }, 'could not post the room panel');
    }
  }

  private async refreshPanel(roomId: string): Promise<void> {
    const view = this.panelView(roomId);
    if (!view) return;
    const messageId = this.deps.rooms.get(roomId)?.panelMessageId;
    const edited =
      messageId != null &&
      (await this.deps.port.editPanel(roomId, messageId, view).then(
        () => true,
        () => false,
      ));
    if (!edited) await this.postPanel(roomId);
  }
}
