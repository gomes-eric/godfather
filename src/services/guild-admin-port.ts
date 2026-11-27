import type { SnapshotChannelKind } from '../setup/model.js';

export interface GuildAdminPort {
  ownerId(): string;
  botTopRolePosition(): number | null;

  members(): MemberView[];
  fetchMember(userId: string): Promise<MemberView | null>;
  fetchUser(userId: string): Promise<UserView | null>;
  kick(userId: string, reason: string): Promise<void>;
  ban(userId: string, reason: string, deleteMessageSeconds: number): Promise<void>;
  fetchBan(userId: string): Promise<UserView | null>;
  unban(userId: string, reason: string): Promise<void>;
  timeout(userId: string, durationMs: number | null, reason: string): Promise<void>;

  roles(): RoleView[];
  createRole(fields: RoleFields & { name: string }): Promise<RoleView>;
  editRole(roleId: string, fields: RoleFields): Promise<void>;
  deleteRole(roleId: string): Promise<void>;
  addRole(userId: string, roleId: string): Promise<void>;
  removeRole(userId: string, roleId: string): Promise<void>;

  channels(): ChannelView[];
  fetchChannel(channelId: string): Promise<ChannelView | null>;
  createChannel(spec: NewChannelSpec): Promise<ChannelView>;
  editChannel(channelId: string, fields: ChannelFields): Promise<void>;
  deleteChannel(channelId: string): Promise<void>;

  newestMessages(channelId: string, limit: number): Promise<MessageView[]>;
  bulkDelete(channelId: string, messageIds: string[]): Promise<number>;
  send(channelId: string, message: OutgoingMessage): Promise<void>;
}

export interface MemberView {
  id: string;
  username: string;
  displayName: string;
  globalName: string | null;
  nickname: string | null;
  bot: boolean;
  roleIds: string[];
  kickable: boolean;
  bannable: boolean;
  moderatable: boolean;
}

export interface UserView {
  id: string;
  username: string;
  bot: boolean;
}

export interface RoleView {
  id: string;
  name: string;
  position: number;
  managed: boolean;
  memberCount: number;
}

export interface RoleFields {
  name?: string;
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
}

export interface ChannelView {
  id: string;
  name: string;
  kind: SnapshotChannelKind;
  parentId: string | null;
  hasTopic: boolean;
  messageable: boolean;
}

export interface NewChannelSpec {
  name: string;
  kind: 'text' | 'voice';
  parentId?: string;
  topic?: string;
  userLimit?: number;
}

export interface ChannelFields {
  name?: string;
  topic?: string;
  userLimit?: number;
}

export interface MessageView {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: Date;
}

export type OutgoingMessage = { allowMentions: boolean } & (
  { content: string } | { embed: { title?: string; description: string } }
);
