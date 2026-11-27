import { PermissionFlagsBits } from 'discord.js';
import { isVoiceKind } from '../config/schema.js';
import type { PermissionOverwrite } from '../core/permission-overwrite.js';
import type { ManagedState } from '../db/managed-objects.js';
import { PANEL_PREFIX } from './desired.js';
import { lockedNicknamePermissions } from './overwrites.js';
import {
  EVERYONE,
  type ChannelSnapshot,
  type DesiredChannel,
  type DesiredOverwrite,
  type DesiredState,
  type GuildSnapshot,
  type SetupOp,
  type SetupPlan,
  type SetupWarning,
} from './model.js';

/**
 * Administrator grants everything, so two sets that both include it are the same in effect; the
 * other bits Discord keeps alongside it (it ticks them all on a new admin role) don't matter.
 */
export function samePermissions(a: bigint, b: bigint): boolean {
  const admin = PermissionFlagsBits.Administrator;
  return a === b || ((a & admin) !== 0n && (b & admin) !== 0n);
}

export interface PlanInput {
  desired: DesiredState;
  snapshot: GuildSnapshot;
  managed: ManagedState;
  prune: boolean;
}

const NEEDS_COMMUNITY = new Set(['announcement', 'forum']);

/** Discord orders siblings by position, then by id (older first). */
function byPosition(a: { position: number; id: string }, b: { position: number; id: string }) {
  return a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
}

function sameOrder(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

export function planSetup(input: PlanInput): SetupPlan {
  return new SetupPlanner(input).plan();
}

class SetupPlanner {
  private readonly warnings: SetupWarning[] = [];
  private readonly adoptOps: SetupOp[] = [];
  private readonly roleOps: SetupOp[] = [];
  private readonly categoryOps: SetupOp[] = [];
  private readonly channelOps: SetupOp[] = [];
  private readonly communityChannelOps: SetupOp[] = [];
  private readonly communityOps: SetupOp[] = [];
  private readonly layoutOps: SetupOp[] = [];
  private readonly panelOps: SetupOp[] = [];
  private readonly deleteOps: SetupOp[] = [];

  private readonly desired: DesiredState;
  private readonly snapshot: GuildSnapshot;
  private readonly managed: ManagedState;
  private readonly prune: boolean;
  private readonly rolesById: Map<string, GuildSnapshot['roles'][number]>;
  private readonly channelsById: Map<string, ChannelSnapshot>;
  private readonly claimed: Set<string>;

  private readonly roleIds = new Map<string, string | undefined>();
  private readonly categoryIds = new Map<string, string | undefined>();
  private readonly channelIds = new Map<string, string | undefined>();
  private readonly existingChannels = new Map<string, ChannelSnapshot>();
  private readonly mismatchedChannels = new Set<string>();
  private managedRoleIds = new Set<string>();

  constructor({ desired, snapshot, managed, prune }: PlanInput) {
    this.desired = desired;
    this.snapshot = snapshot;
    this.managed = managed;
    this.prune = prune;
    this.rolesById = new Map(snapshot.roles.map((r) => [r.id, r]));
    this.channelsById = new Map(snapshot.channels.map((c) => [c.id, c]));
    this.claimed = new Set<string>(
      [...managed.role.values(), ...managed.category.values(), ...managed.channel.values()].map(
        (e) => e.discordId,
      ),
    );
  }

  plan(): SetupPlan {
    this.planRoles();
    this.planCategories();
    this.planChannels();
    this.planCommunity();
    this.planLayout();
    this.planAfkAndNicknames();
    this.planPanels();
    if (this.prune) this.planDeletions();
    return {
      ops: [
        ...this.adoptOps,
        ...this.roleOps,
        ...this.categoryOps,
        ...this.channelOps,
        ...this.communityOps,
        ...this.communityChannelOps,
        ...this.layoutOps,
        ...this.panelOps,
        ...this.deleteOps,
      ],
      warnings: this.warnings,
    };
  }

  private adopt<T extends { id: string }>(
    kind: 'role' | 'category' | 'channel',
    key: string,
    name: string,
    pool: readonly T[],
    matches: (item: T) => boolean,
  ): T | undefined {
    const found = pool.find((item) => matches(item) && !this.claimed.has(item.id));
    if (found) {
      this.claimed.add(found.id);
      this.adoptOps.push({ type: 'adopt', kind, key, id: found.id, name });
    }
    return found;
  }

  private planRoles(): void {
    const { desired, snapshot, managed, rolesById, roleIds } = this;
    const rolesAboveBot = new Set<string>();

    for (const role of desired.roles) {
      let existing = rolesById.get(managed.role.get(role.key)?.discordId ?? '');
      existing ??= this.adopt(
        'role',
        role.key,
        role.name,
        snapshot.roles,
        (r) => !r.integration && r.id !== snapshot.everyoneRoleId && r.name === role.name,
      );

      if (!existing) {
        roleIds.set(role.key, undefined);
        this.roleOps.push({ type: 'createRole', role });
        continue;
      }

      roleIds.set(role.key, existing.id);
      const changes: string[] = [];
      if (existing.name !== role.name) changes.push('name');
      if (existing.color !== role.color) changes.push('color');
      if (existing.hoist !== role.hoist) changes.push('hoist');
      if (existing.mentionable !== role.mentionable) changes.push('mentionable');
      if (!samePermissions(existing.permissions, role.permissions)) changes.push('permissions');

      if (existing.position >= snapshot.botRolePosition) {
        rolesAboveBot.add(role.key);
        if (changes.length > 0) {
          this.warnings.push({ type: 'roleAboveBot', key: role.key, name: existing.name, changes });
        }
        continue;
      }

      if (changes.length > 0) {
        this.roleOps.push({ type: 'updateRole', role, id: existing.id, changes });
      }
    }

    const orderedRoleKeys = desired.roles.map((r) => r.key).filter((k) => !rolesAboveBot.has(k));
    const roleCreated = orderedRoleKeys.some((k) => roleIds.get(k) === undefined);
    const currentRoleOrder = orderedRoleKeys
      .filter((k) => roleIds.get(k) !== undefined)
      .map((k) => ({ key: k, role: rolesById.get(roleIds.get(k)!)! }))
      // Highest first; on a tie (new roles all start at position 1) the older role ranks higher.
      .sort((a, b) => -byPosition(a.role, b.role))
      .map((entry) => entry.key);
    const expectedRoleOrder = orderedRoleKeys.filter((k) => roleIds.get(k) !== undefined);
    if (roleCreated || !sameOrder(currentRoleOrder, expectedRoleOrder)) {
      this.roleOps.push({ type: 'reorderRoles', keys: orderedRoleKeys });
    }

    this.managedRoleIds = new Set<string>([
      snapshot.everyoneRoleId,
      ...[...managed.role.values()].map((e) => e.discordId),
      ...[...roleIds.values()].filter((id): id is string => id !== undefined),
    ]);
  }

  private overwritesMatch(wanted: DesiredOverwrite[], current: PermissionOverwrite[]): boolean {
    const resolved = new Map<string, { allow: bigint; deny: bigint }>();
    for (const o of wanted) {
      const id = o.target === EVERYONE ? this.snapshot.everyoneRoleId : this.roleIds.get(o.target);
      if (id === undefined) return false;
      resolved.set(id, { allow: o.allow, deny: o.deny });
    }
    const owned = current.filter((o) => o.type === 'role' && this.managedRoleIds.has(o.id));
    return (
      owned.length === resolved.size &&
      owned.every((o) => {
        const want = resolved.get(o.id);
        return want !== undefined && want.allow === o.allow && want.deny === o.deny;
      })
    );
  }

  private planCategories(): void {
    const { desired, snapshot, managed, channelsById, categoryIds } = this;
    for (const category of desired.categories) {
      let existing = channelsById.get(managed.category.get(category.key)?.discordId ?? '');
      if (existing && existing.kind !== 'category') existing = undefined;
      existing ??= this.adopt(
        'category',
        category.key,
        category.name,
        snapshot.channels,
        (c) => c.kind === 'category' && c.name === category.name,
      );

      if (!existing) {
        categoryIds.set(category.key, undefined);
        this.categoryOps.push({ type: 'createCategory', category });
        continue;
      }

      categoryIds.set(category.key, existing.id);
      const changes: string[] = [];
      if (existing.name !== category.name) changes.push('name');
      if (!this.overwritesMatch(category.overwrites, existing.overwrites))
        changes.push('overwrites');
      if (changes.length > 0) {
        this.categoryOps.push({ type: 'updateCategory', category, id: existing.id, changes });
      }
    }
  }

  private planChannels(): void {
    const { desired, snapshot, managed, channelsById, channelIds } = this;
    for (const channel of desired.channels) {
      let existing = channelsById.get(managed.channel.get(channel.key)?.discordId ?? '');
      if (existing && existing.kind !== channel.kind) {
        this.warnings.push({
          type: 'channelKindMismatch',
          key: channel.key,
          name: existing.name,
          expected: channel.kind,
          actual: existing.kind,
        });
        channelIds.set(channel.key, existing.id);
        this.mismatchedChannels.add(channel.key);
        continue;
      }
      existing ??= this.adopt(
        'channel',
        channel.key,
        channel.name,
        snapshot.channels,
        (c) => c.kind === channel.kind && c.name === channel.name,
      );

      if (!existing) {
        channelIds.set(channel.key, undefined);
        const op: SetupOp = { type: 'createChannel', channel };
        (NEEDS_COMMUNITY.has(channel.kind) ? this.communityChannelOps : this.channelOps).push(op);
        continue;
      }

      channelIds.set(channel.key, existing.id);
      this.existingChannels.set(channel.key, existing);
      const changes = channelChanges(channel, existing, this.categoryIds.get(channel.categoryKey));
      if (!this.overwritesMatch(channel.overwrites, existing.overwrites))
        changes.push('overwrites');
      if (changes.length > 0) {
        this.channelOps.push({ type: 'updateChannel', channel, id: existing.id, changes });
      }
    }
  }

  private planCommunity(): void {
    const { community } = this.desired;
    const { snapshot } = this;
    if (!community.enable) return;
    const rulesId = this.channelIds.get(community.rulesChannelKey);
    const updatesId = this.channelIds.get(community.updatesChannelKey);
    if (!snapshot.community) {
      this.communityOps.push({
        type: 'enableCommunity',
        rulesChannelKey: community.rulesChannelKey,
        updatesChannelKey: community.updatesChannelKey,
      });
    } else if (
      rulesId === undefined ||
      updatesId === undefined ||
      snapshot.rulesChannelId !== rulesId ||
      snapshot.publicUpdatesChannelId !== updatesId
    ) {
      this.communityOps.push({
        type: 'setCommunityChannels',
        rulesChannelKey: community.rulesChannelKey,
        updatesChannelKey: community.updatesChannelKey,
      });
    }
  }

  private planLayout(): void {
    const categoryKeys = this.desired.categories.map((c) => c.key);
    const channelKeysByCategory: Record<string, string[]> = {};
    for (const channel of this.desired.channels) {
      if (this.mismatchedChannels.has(channel.key)) continue;
      (channelKeysByCategory[channel.categoryKey] ??= []).push(channel.key);
    }
    if (this.layoutChanged(categoryKeys, channelKeysByCategory)) {
      this.layoutOps.push({
        type: 'reorderChannels',
        categoryKeys,
        channelKeys: channelKeysByCategory,
      });
    }
  }

  private layoutChanged(
    categoryKeys: string[],
    channelKeysByCategory: Record<string, string[]>,
  ): boolean {
    const { categoryIds, channelsById, existingChannels } = this;
    if (categoryKeys.some((k) => categoryIds.get(k) === undefined)) return true;
    const currentCategoryOrder = categoryKeys
      .map((k) => ({ key: k, ...channelsById.get(categoryIds.get(k)!)! }))
      .sort(byPosition)
      .map((c) => c.key);
    if (!sameOrder(currentCategoryOrder, categoryKeys)) return true;

    const kindByKey = new Map(this.desired.channels.map((c) => [c.key, c.kind]));
    for (const [categoryKey, keys] of Object.entries(channelKeysByCategory)) {
      const parentId = categoryIds.get(categoryKey);
      for (const voice of [false, true]) {
        const group = keys.filter((k) => isVoiceKind(kindByKey.get(k)!) === voice);
        const current = group.map((k) => existingChannels.get(k));
        if (current.some((c) => c === undefined || c.parentId !== parentId)) return true;
        const currentOrder = group
          .map((k) => ({ key: k, ...existingChannels.get(k)! }))
          .sort(byPosition)
          .map((c) => c.key);
        if (!sameOrder(currentOrder, group)) return true;
      }
    }
    return false;
  }

  private planAfkAndNicknames(): void {
    const { desired, snapshot } = this;
    const afkId = this.channelIds.get(desired.afk.channelKey);
    if (
      afkId === undefined ||
      snapshot.afkChannelId !== afkId ||
      snapshot.afkTimeout !== desired.afk.timeoutSeconds
    ) {
      this.layoutOps.push({
        type: 'setAfk',
        channelKey: desired.afk.channelKey,
        channelName: desired.afk.channelName,
        timeoutSeconds: desired.afk.timeoutSeconds,
      });
    }

    const everyone = lockedNicknamePermissions(snapshot.everyonePermissions, desired.lockNicknames);
    if (everyone !== snapshot.everyonePermissions) {
      this.layoutOps.push({
        type: 'setNicknameLock',
        locked: desired.lockNicknames,
        permissions: everyone,
      });
    }
  }

  private planPanels(): void {
    for (const panel of this.desired.panels) {
      const entry = this.managed.message.get(panel.key);
      const exists = entry !== undefined && this.snapshot.existingMessageIds.has(entry.discordId);
      if (!exists || entry.fingerprint !== panel.fingerprint) {
        this.panelOps.push({
          type: 'upsertPanel',
          panel,
          messageId: exists ? entry.discordId : null,
        });
      }
    }
  }

  private planDeletions(): void {
    const { desired, managed, snapshot, channelsById, rolesById, deleteOps } = this;
    const wanted = {
      role: new Set(desired.roles.map((r) => r.key)),
      category: new Set(desired.categories.map((c) => c.key)),
      channel: new Set(desired.channels.map((c) => c.key)),
    };
    for (const [key, entry] of managed.channel) {
      const channel = channelsById.get(entry.discordId);
      if (channel && !wanted.channel.has(key) && !desired.unmanagedKeys.channel.has(key)) {
        deleteOps.push({ type: 'deleteChannel', key, id: channel.id, name: channel.name });
      }
    }
    for (const [key, entry] of managed.category) {
      const category = channelsById.get(entry.discordId);
      if (category && !wanted.category.has(key) && !desired.unmanagedKeys.category.has(key)) {
        deleteOps.push({ type: 'deleteCategory', key, id: category.id, name: category.name });
      }
    }
    for (const [key, entry] of managed.role) {
      const role = rolesById.get(entry.discordId);
      if (
        role &&
        !wanted.role.has(key) &&
        !desired.unmanagedKeys.role.has(key) &&
        role.position < snapshot.botRolePosition
      ) {
        deleteOps.push({ type: 'deleteRole', key, id: role.id, name: role.name });
      }
    }
    const panelKeys = new Set(desired.panels.map((p) => p.key));
    for (const [key, entry] of managed.message) {
      if (key.startsWith(PANEL_PREFIX) && !panelKeys.has(key)) {
        deleteOps.push({ type: 'forgetMessage', key, id: entry.discordId });
      }
    }
  }
}

function channelChanges(
  channel: DesiredChannel,
  existing: ChannelSnapshot,
  parentId: string | undefined,
): string[] {
  const changes: string[] = [];
  if (existing.name !== channel.name) changes.push('name');
  if (parentId === undefined || existing.parentId !== parentId) changes.push('parent');
  const isVoice = isVoiceKind(channel.kind);
  if (!isVoice && (existing.topic ?? null) !== channel.topic) changes.push('topic');
  if (channel.kind === 'voice' && existing.userLimit !== channel.userLimit) {
    changes.push('userLimit');
  }
  if (channel.kind === 'forum') {
    const tagsMatch =
      existing.tags.length === channel.tags.length &&
      existing.tags.every(
        (tag, i) => tag.name === channel.tags[i]?.name && tag.emoji === channel.tags[i]?.emoji,
      );
    if (!tagsMatch) changes.push('tags');
    if (existing.requireTag !== channel.requireTag) changes.push('requireTag');
  }
  return changes;
}
