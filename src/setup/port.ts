import type { ChannelKind } from '../config/schema.js';
import type { PermissionOverwrite } from '../core/permission-overwrite.js';
import type { ForumTag, GuildSnapshot, PanelButton } from './model.js';

export interface RoleSpec {
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: bigint;
}

export interface ChannelSpec {
  name: string;
  kind: ChannelKind | 'category';
  parentId: string | null;
  topic: string | null;
  userLimit: number;
  overwrites: PermissionOverwrite[];
  /** Existing tag ids are kept so posts don't lose their tags on edit. */
  tags: (ForumTag & { id?: string })[];
  requireTag: boolean;
}

export interface PanelMessage {
  title: string | null;
  description: string;
  color: number;
  buttons: PanelButton[];
}

export interface ChannelPosition {
  id: string;
  parentId: string | null;
  position: number;
}

export interface GuildPort {
  snapshot(messages: { channelId: string; messageId: string }[]): Promise<GuildSnapshot>;

  createRole(spec: RoleSpec): Promise<string>;
  editRole(id: string, spec: RoleSpec): Promise<void>;
  deleteRole(id: string): Promise<void>;
  setRolePositions(idsTopToBottom: string[]): Promise<void>;

  createChannel(spec: ChannelSpec): Promise<string>;
  editChannel(id: string, spec: ChannelSpec): Promise<void>;
  deleteChannel(id: string): Promise<void>;
  setChannelPositions(positions: ChannelPosition[]): Promise<void>;

  enableCommunity(rulesChannelId: string, updatesChannelId: string): Promise<void>;
  setCommunityChannels(rulesChannelId: string, updatesChannelId: string): Promise<void>;
  setAfk(channelId: string, timeoutSeconds: number): Promise<void>;
  setEveryonePermissions(permissions: bigint): Promise<void>;

  upsertPanel(channelId: string, messageId: string | null, panel: PanelMessage): Promise<string>;
}
