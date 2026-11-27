import type { PermissionOverwrite } from '../core/permission-overwrite.js';
import type { RoomAccess } from '../core/voice-rooms.js';

export interface RoomMember {
  id: string;
  displayName: string;
  username: string;
  bot: boolean;
}

export interface VoiceChannelInfo {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  userLimit: number;
  overwrites: PermissionOverwrite[];
}

export interface RoomChannelSpec {
  name: string;
  parentId: string | null;
  position: number;
  userLimit: number;
  overwrites: PermissionOverwrite[];
  reason: string;
}

export interface RoomPanelView extends RoomAccess {
  roomId: string;
  ownerId: string;
  userLimit: number;
}

export type RenameResult = 'done' | 'queued';

export interface VoiceRoomPort {
  readonly everyoneRoleId: string;
  voiceChannel(id: string): VoiceChannelInfo | undefined;
  members(channelId: string): RoomMember[];
  voiceChannelOf(userId: string): string | null;

  createChannel(spec: RoomChannelSpec): Promise<string>;
  deleteChannelIfExists(id: string, reason: string): Promise<void>;
  moveMember(userId: string, channelId: string, reason: string): Promise<void>;
  disconnectMember(userId: string, reason: string): Promise<void>;
  setOverwrites(channelId: string, overwrites: PermissionOverwrite[]): Promise<void>;
  setUserLimit(channelId: string, limit: number): Promise<void>;
  setName(channelId: string, name: string): Promise<RenameResult>;

  postPanel(channelId: string, view: RoomPanelView): Promise<string>;
  editPanel(channelId: string, messageId: string, view: RoomPanelView): Promise<void>;
}
