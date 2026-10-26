import type { ChannelKind } from '../config/schema.js';

// Data model of the /setup reconciliation (PLAN.md §6.1). Everything here is plain data so the
// planner can be tested without Discord.

/** "@everyone" or a role key from server.yaml. */
export type OverwriteTarget = string;
export const EVERYONE: OverwriteTarget = '@everyone';

export interface DesiredOverwrite {
  target: OverwriteTarget;
  allow: bigint;
  deny: bigint;
}

export interface ForumTag {
  name: string;
  emoji: string | null;
}

export interface DesiredRole {
  key: string;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: bigint;
}

export interface DesiredCategory {
  key: string;
  name: string;
  overwrites: DesiredOverwrite[];
}

export interface DesiredChannel {
  key: string;
  categoryKey: string;
  kind: ChannelKind;
  name: string;
  topic: string | null;
  userLimit: number;
  overwrites: DesiredOverwrite[];
  tags: ForumTag[];
  requireTag: boolean;
}

export interface PanelButton {
  customId: string;
  label: string;
  emoji: string | null;
  /** Buttons with the same row share a line (max 5 per line); unset rows fill lines of 5. */
  row?: number;
  style?: 'primary' | 'secondary' | 'success' | 'danger';
}

export interface DesiredPanel {
  key: string;
  channelKey: string;
  /** For display only. */
  channelName: string;
  title: string | null;
  description: string;
  color: number;
  buttons: PanelButton[];
  /** Hash of everything above; a different value means the posted message needs an edit. */
  fingerprint: string;
}

export interface DesiredState {
  /** Top to bottom, as they should appear in the role list. */
  roles: DesiredRole[];
  categories: DesiredCategory[];
  /** In display order within each category. */
  channels: DesiredChannel[];
  community: { enable: boolean; rulesChannelKey: string; updatesChannelKey: string };
  afk: { channelKey: string; channelName: string; timeoutSeconds: number };
  /** Whether @everyone lacks ChangeNickname, so only the bot (and admins) change nicknames. */
  lockNicknames: boolean;
  panels: DesiredPanel[];
  /** Keys marked `managed: false`: never touched and never pruned. */
  unmanagedKeys: { role: Set<string>; category: Set<string>; channel: Set<string> };
}

export interface RoleSnapshot {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: bigint;
  position: number;
  /** Created by an integration (a bot's own role); cannot be adopted or edited. */
  integration: boolean;
}

export interface OverwriteSnapshot {
  id: string;
  type: 'role' | 'member';
  allow: bigint;
  deny: bigint;
}

export type SnapshotChannelKind = ChannelKind | 'category' | 'other';

export interface ChannelSnapshot {
  id: string;
  name: string;
  kind: SnapshotChannelKind;
  parentId: string | null;
  position: number;
  topic: string | null;
  userLimit: number;
  overwrites: OverwriteSnapshot[];
  tags: (ForumTag & { id: string })[];
  requireTag: boolean;
}

export interface GuildSnapshot {
  everyoneRoleId: string;
  /** Base permissions of @everyone. */
  everyonePermissions: bigint;
  /** Position of the bot's highest role; it can only manage roles strictly below it. */
  botRolePosition: number;
  roles: RoleSnapshot[];
  channels: ChannelSnapshot[];
  community: boolean;
  rulesChannelId: string | null;
  publicUpdatesChannelId: string | null;
  afkChannelId: string | null;
  afkTimeout: number;
  /** Managed panel messages that still exist. */
  existingMessageIds: Set<string>;
}

export type ManagedKindForSetup = 'role' | 'category' | 'channel';

export type SetupOp =
  | { type: 'adopt'; kind: ManagedKindForSetup; key: string; id: string; name: string }
  | { type: 'createRole'; role: DesiredRole }
  | { type: 'updateRole'; role: DesiredRole; id: string; changes: string[] }
  | { type: 'reorderRoles'; keys: string[] }
  | { type: 'createCategory'; category: DesiredCategory }
  | { type: 'updateCategory'; category: DesiredCategory; id: string; changes: string[] }
  | { type: 'createChannel'; channel: DesiredChannel }
  | { type: 'updateChannel'; channel: DesiredChannel; id: string; changes: string[] }
  | { type: 'enableCommunity'; rulesChannelKey: string; updatesChannelKey: string }
  | { type: 'setCommunityChannels'; rulesChannelKey: string; updatesChannelKey: string }
  | { type: 'reorderChannels'; categoryKeys: string[]; channelKeys: Record<string, string[]> }
  | { type: 'setAfk'; channelKey: string; channelName: string; timeoutSeconds: number }
  | { type: 'setNicknameLock'; locked: boolean; permissions: bigint }
  | { type: 'upsertPanel'; panel: DesiredPanel; messageId: string | null }
  | {
      type: 'deleteChannel' | 'deleteCategory' | 'deleteRole';
      key: string;
      id: string;
      name: string;
    }
  | { type: 'forgetMessage'; key: string; id: string };

export type SetupWarning =
  | { type: 'roleAboveBot'; key: string; name: string; changes: string[] }
  | {
      type: 'channelKindMismatch';
      key: string;
      name: string;
      expected: string;
      actual: string;
    };

export interface SetupPlan {
  ops: SetupOp[];
  warnings: SetupWarning[];
}
