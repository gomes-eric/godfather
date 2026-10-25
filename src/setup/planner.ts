import type { ManagedState } from '../db/managed-objects.js';
import { PANEL_PREFIX } from './desired.js';
import {
  EVERYONE,
  type ChannelSnapshot,
  type DesiredChannel,
  type DesiredOverwrite,
  type DesiredState,
  type GuildSnapshot,
  type OverwriteSnapshot,
  type SetupOp,
  type SetupPlan,
  type SetupWarning,
} from './model.js';

export interface PlanInput {
  desired: DesiredState;
  snapshot: GuildSnapshot;
  managed: ManagedState;
  /** Delete managed objects that are no longer in server.yaml. */
  prune: boolean;
}

const TEXT_LIKE = new Set(['text', 'announcement', 'forum']);
const NEEDS_COMMUNITY = new Set(['announcement', 'forum']);

/** Discord orders siblings by position, then by id (older first). */
function byPosition(a: { position: number; id: string }, b: { position: number; id: string }) {
  return a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
}

function sameOrder(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

/**
 * Compares the desired reconciliation target with the live guild and lists what must change.
 * Pure: the same inputs always give the same plan, and applying a plan then planning again
 * gives an empty plan.
 */
export function planSetup({ desired, snapshot, managed, prune }: PlanInput): SetupPlan {
  const warnings: SetupWarning[] = [];
  const adoptOps: SetupOp[] = [];
  const roleOps: SetupOp[] = [];
  const categoryOps: SetupOp[] = [];
  const channelOps: SetupOp[] = [];
  const communityChannelOps: SetupOp[] = [];
  const communityOps: SetupOp[] = [];
  const layoutOps: SetupOp[] = [];
  const panelOps: SetupOp[] = [];
  const deleteOps: SetupOp[] = [];

  const rolesById = new Map(snapshot.roles.map((r) => [r.id, r]));
  const channelsById = new Map(snapshot.channels.map((c) => [c.id, c]));

  // Objects already tied to a key can't be adopted by another key.
  const claimed = new Set<string>(
    [...managed.role.values(), ...managed.category.values(), ...managed.channel.values()].map(
      (e) => e.discordId,
    ),
  );

  // ---- Roles ---------------------------------------------------------------------------------
  const roleIds = new Map<string, string | undefined>();
  const rolesAboveBot = new Set<string>();

  for (const role of desired.roles) {
    let existing = rolesById.get(managed.role.get(role.key)?.discordId ?? '');
    if (!existing) {
      existing = snapshot.roles.find(
        (r) =>
          !r.integration &&
          r.id !== snapshot.everyoneRoleId &&
          r.name === role.name &&
          !claimed.has(r.id),
      );
      if (existing) {
        claimed.add(existing.id);
        adoptOps.push({
          type: 'adopt',
          kind: 'role',
          key: role.key,
          id: existing.id,
          name: role.name,
        });
      }
    }

    if (!existing) {
      roleIds.set(role.key, undefined);
      roleOps.push({ type: 'createRole', role });
      continue;
    }

    roleIds.set(role.key, existing.id);
    const changes: string[] = [];
    if (existing.name !== role.name) changes.push('name');
    if (existing.color !== role.color) changes.push('color');
    if (existing.hoist !== role.hoist) changes.push('hoist');
    if (existing.mentionable !== role.mentionable) changes.push('mentionable');
    if (existing.permissions !== role.permissions) changes.push('permissions');

    // The bot can't edit roles above its own (e.g. Comandante, kept at the top on purpose).
    // It still tracks the role; it only warns when the role differs from server.yaml.
    if (existing.position >= snapshot.botRolePosition) {
      rolesAboveBot.add(role.key);
      if (changes.length > 0) {
        warnings.push({ type: 'roleAboveBot', key: role.key, name: existing.name, changes });
      }
      continue;
    }

    if (changes.length > 0) {
      roleOps.push({ type: 'updateRole', role, id: existing.id, changes });
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
    roleOps.push({ type: 'reorderRoles', keys: orderedRoleKeys });
  }

  // ---- Overwrites ------------------------------------------------------------------------------
  // Overwrites for @everyone and for managed roles are owned by /setup; any other overwrite
  // (a member, another bot's role) is left alone.
  const managedRoleIds = new Set<string>([
    snapshot.everyoneRoleId,
    ...[...managed.role.values()].map((e) => e.discordId),
    ...[...roleIds.values()].filter((id): id is string => id !== undefined),
  ]);

  const overwritesMatch = (wanted: DesiredOverwrite[], current: OverwriteSnapshot[]): boolean => {
    const resolved = new Map<string, { allow: bigint; deny: bigint }>();
    for (const o of wanted) {
      const id = o.target === EVERYONE ? snapshot.everyoneRoleId : roleIds.get(o.target);
      if (id === undefined) return false; // role not created yet
      resolved.set(id, { allow: o.allow, deny: o.deny });
    }
    const owned = current.filter((o) => o.type === 'role' && managedRoleIds.has(o.id));
    return (
      owned.length === resolved.size &&
      owned.every((o) => {
        const want = resolved.get(o.id);
        return want !== undefined && want.allow === o.allow && want.deny === o.deny;
      })
    );
  };

  // ---- Categories ------------------------------------------------------------------------------
  const categoryIds = new Map<string, string | undefined>();

  for (const category of desired.categories) {
    let existing = channelsById.get(managed.category.get(category.key)?.discordId ?? '');
    if (existing && existing.kind !== 'category') existing = undefined;
    if (!existing) {
      existing = snapshot.channels.find(
        (c) => c.kind === 'category' && c.name === category.name && !claimed.has(c.id),
      );
      if (existing) {
        claimed.add(existing.id);
        adoptOps.push({
          type: 'adopt',
          kind: 'category',
          key: category.key,
          id: existing.id,
          name: category.name,
        });
      }
    }

    if (!existing) {
      categoryIds.set(category.key, undefined);
      categoryOps.push({ type: 'createCategory', category });
      continue;
    }

    categoryIds.set(category.key, existing.id);
    const changes: string[] = [];
    if (existing.name !== category.name) changes.push('name');
    if (!overwritesMatch(category.overwrites, existing.overwrites)) changes.push('overwrites');
    if (changes.length > 0) {
      categoryOps.push({ type: 'updateCategory', category, id: existing.id, changes });
    }
  }

  // ---- Channels --------------------------------------------------------------------------------
  const channelIds = new Map<string, string | undefined>();
  const existingChannels = new Map<string, ChannelSnapshot>();
  const mismatchedChannels = new Set<string>();

  for (const channel of desired.channels) {
    let existing = channelsById.get(managed.channel.get(channel.key)?.discordId ?? '');
    if (existing && existing.kind !== channel.kind) {
      warnings.push({
        type: 'channelKindMismatch',
        key: channel.key,
        name: existing.name,
        expected: channel.kind,
        actual: existing.kind,
      });
      channelIds.set(channel.key, existing.id);
      mismatchedChannels.add(channel.key);
      continue;
    }
    if (!existing) {
      existing = snapshot.channels.find(
        (c) => c.kind === channel.kind && c.name === channel.name && !claimed.has(c.id),
      );
      if (existing) {
        claimed.add(existing.id);
        adoptOps.push({
          type: 'adopt',
          kind: 'channel',
          key: channel.key,
          id: existing.id,
          name: channel.name,
        });
      }
    }

    if (!existing) {
      channelIds.set(channel.key, undefined);
      const op: SetupOp = { type: 'createChannel', channel };
      (NEEDS_COMMUNITY.has(channel.kind) ? communityChannelOps : channelOps).push(op);
      continue;
    }

    channelIds.set(channel.key, existing.id);
    existingChannels.set(channel.key, existing);
    const changes = channelChanges(channel, existing, categoryIds.get(channel.categoryKey));
    if (!overwritesMatch(channel.overwrites, existing.overwrites)) changes.push('overwrites');
    if (changes.length > 0) {
      channelOps.push({ type: 'updateChannel', channel, id: existing.id, changes });
    }
  }

  // ---- Community -------------------------------------------------------------------------------
  const { community } = desired;
  if (community.enable) {
    const rulesId = channelIds.get(community.rulesChannelKey);
    const updatesId = channelIds.get(community.updatesChannelKey);
    if (!snapshot.community) {
      communityOps.push({
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
      communityOps.push({
        type: 'setCommunityChannels',
        rulesChannelKey: community.rulesChannelKey,
        updatesChannelKey: community.updatesChannelKey,
      });
    }
  }

  // ---- Layout (order of categories and channels) -----------------------------------------------
  const categoryKeys = desired.categories.map((c) => c.key);
  const channelKeysByCategory: Record<string, string[]> = {};
  for (const channel of desired.channels) {
    if (mismatchedChannels.has(channel.key)) continue;
    (channelKeysByCategory[channel.categoryKey] ??= []).push(channel.key);
  }

  const layoutChanged = (() => {
    if (categoryKeys.some((k) => categoryIds.get(k) === undefined)) return true;
    const currentCategoryOrder = categoryKeys
      .map((k) => ({ key: k, ...channelsById.get(categoryIds.get(k)!)! }))
      .sort(byPosition)
      .map((c) => c.key);
    if (!sameOrder(currentCategoryOrder, categoryKeys)) return true;

    for (const [categoryKey, keys] of Object.entries(channelKeysByCategory)) {
      const parentId = categoryIds.get(categoryKey);
      for (const textLike of [true, false]) {
        const group = keys.filter((k) => {
          const kind = desired.channels.find((c) => c.key === k)!.kind;
          return TEXT_LIKE.has(kind) === textLike;
        });
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
  })();
  if (layoutChanged) {
    layoutOps.push({ type: 'reorderChannels', categoryKeys, channelKeys: channelKeysByCategory });
  }

  const afkId = channelIds.get(desired.afk.channelKey);
  if (
    afkId === undefined ||
    snapshot.afkChannelId !== afkId ||
    snapshot.afkTimeout !== desired.afk.timeoutSeconds
  ) {
    layoutOps.push({
      type: 'setAfk',
      channelKey: desired.afk.channelKey,
      channelName: desired.afk.channelName,
      timeoutSeconds: desired.afk.timeoutSeconds,
    });
  }

  // ---- Panels ----------------------------------------------------------------------------------
  for (const panel of desired.panels) {
    const entry = managed.message.get(panel.key);
    const exists = entry !== undefined && snapshot.existingMessageIds.has(entry.discordId);
    if (!exists || entry.fingerprint !== panel.fingerprint) {
      panelOps.push({ type: 'upsertPanel', panel, messageId: exists ? entry.discordId : null });
    }
  }

  // ---- Prune -----------------------------------------------------------------------------------
  if (prune) {
    const wanted = {
      role: new Set(desired.roles.map((r) => r.key)),
      category: new Set(categoryKeys),
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
    // Only /setup's own panels; other managed messages (e.g. the #agenda post) belong elsewhere.
    const panelKeys = new Set(desired.panels.map((p) => p.key));
    for (const [key, entry] of managed.message) {
      if (key.startsWith(PANEL_PREFIX) && !panelKeys.has(key)) {
        deleteOps.push({ type: 'forgetMessage', key, id: entry.discordId });
      }
    }
  }

  return {
    ops: [
      ...adoptOps,
      ...roleOps,
      ...categoryOps,
      ...channelOps,
      ...communityOps,
      ...communityChannelOps,
      ...layoutOps,
      ...panelOps,
      ...deleteOps,
    ],
    warnings,
  };
}

function channelChanges(
  channel: DesiredChannel,
  existing: ChannelSnapshot,
  parentId: string | undefined,
): string[] {
  const changes: string[] = [];
  if (existing.name !== channel.name) changes.push('name');
  if (parentId === undefined || existing.parentId !== parentId) changes.push('parent');
  const isVoice = channel.kind === 'voice' || channel.kind === 'stage';
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
