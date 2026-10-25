import type { ManagedObjectStore } from '../db/managed-objects.js';
import {
  EVERYONE,
  type DesiredChannel,
  type DesiredOverwrite,
  type GuildSnapshot,
  type SetupOp,
  type SetupPlan,
} from './model.js';
import type { ChannelPosition, ChannelSpec, ConcreteOverwrite, GuildPort } from './port.js';

export interface ApplyFailure {
  op: SetupOp;
  error: string;
}

export interface ApplyResult {
  applied: SetupOp[];
  failures: ApplyFailure[];
}

export interface ApplyDeps {
  port: GuildPort;
  store: ManagedObjectStore;
  /** The snapshot the plan was computed from (for overwrites and tags to preserve). */
  snapshot: GuildSnapshot;
}

/**
 * Runs the plan op by op. A failing op is recorded and the rest continue, so one bad item
 * doesn't block the whole layout; running /setup again retries whatever is still different.
 */
export async function applySetup(plan: SetupPlan, deps: ApplyDeps): Promise<ApplyResult> {
  const { port, store, snapshot } = deps;
  const managed = store.all();
  const roleIds = new Map([...managed.role].map(([key, e]) => [key, e.discordId]));
  const categoryIds = new Map([...managed.category].map(([key, e]) => [key, e.discordId]));
  const channelIds = new Map([...managed.channel].map(([key, e]) => [key, e.discordId]));
  const channelsById = new Map(snapshot.channels.map((c) => [c.id, c]));

  const resolveOverwrites = (overwrites: DesiredOverwrite[]): ConcreteOverwrite[] =>
    overwrites.flatMap((o) => {
      const id = o.target === EVERYONE ? snapshot.everyoneRoleId : roleIds.get(o.target);
      return id === undefined ? [] : [{ id, type: 'role' as const, allow: o.allow, deny: o.deny }];
    });

  /** Overwrites /setup doesn't own (members, other bots' roles) survive an edit. */
  const foreignOverwrites = (existingId: string | undefined): ConcreteOverwrite[] => {
    const owned = new Set([snapshot.everyoneRoleId, ...roleIds.values()]);
    const existing = existingId ? channelsById.get(existingId) : undefined;
    return (existing?.overwrites ?? []).filter((o) => o.type === 'member' || !owned.has(o.id));
  };

  const channelSpec = (channel: DesiredChannel, existingId?: string): ChannelSpec => {
    const existingTags = existingId ? (channelsById.get(existingId)?.tags ?? []) : [];
    return {
      name: channel.name,
      kind: channel.kind,
      parentId: categoryIds.get(channel.categoryKey) ?? null,
      topic: channel.topic,
      userLimit: channel.userLimit,
      overwrites: [...resolveOverwrites(channel.overwrites), ...foreignOverwrites(existingId)],
      tags: channel.tags.map((tag) => {
        const id = existingTags.find((t) => t.name === tag.name)?.id;
        return id ? { ...tag, id } : tag;
      }),
      requireTag: channel.requireTag,
    };
  };

  const requireId = (map: Map<string, string>, key: string, what: string): string => {
    const id = map.get(key);
    if (!id) throw new Error(`${what} "${key}" does not exist (creating it failed?)`);
    return id;
  };

  const run = async (op: SetupOp): Promise<void> => {
    switch (op.type) {
      case 'adopt': {
        store.set(op.kind, op.key, op.id);
        ({ role: roleIds, category: categoryIds, channel: channelIds })[op.kind].set(op.key, op.id);
        return;
      }
      case 'createRole': {
        const id = await port.createRole(op.role);
        store.set('role', op.role.key, id);
        roleIds.set(op.role.key, id);
        return;
      }
      case 'updateRole':
        return port.editRole(op.id, op.role);
      case 'reorderRoles':
        return port.setRolePositions(
          op.keys.map((key) => roleIds.get(key)).filter((id): id is string => id !== undefined),
        );
      case 'createCategory': {
        const id = await port.createChannel({
          name: op.category.name,
          kind: 'category',
          parentId: null,
          topic: null,
          userLimit: 0,
          overwrites: resolveOverwrites(op.category.overwrites),
          tags: [],
          requireTag: false,
        });
        store.set('category', op.category.key, id);
        categoryIds.set(op.category.key, id);
        return;
      }
      case 'updateCategory':
        return port.editChannel(op.id, {
          name: op.category.name,
          kind: 'category',
          parentId: null,
          topic: null,
          userLimit: 0,
          overwrites: [...resolveOverwrites(op.category.overwrites), ...foreignOverwrites(op.id)],
          tags: [],
          requireTag: false,
        });
      case 'createChannel': {
        const id = await port.createChannel(channelSpec(op.channel));
        store.set('channel', op.channel.key, id);
        channelIds.set(op.channel.key, id);
        return;
      }
      case 'updateChannel':
        return port.editChannel(op.id, channelSpec(op.channel, op.id));
      case 'enableCommunity':
        return port.enableCommunity(
          requireId(channelIds, op.rulesChannelKey, 'channel'),
          requireId(channelIds, op.updatesChannelKey, 'channel'),
        );
      case 'setCommunityChannels':
        return port.setCommunityChannels(
          requireId(channelIds, op.rulesChannelKey, 'channel'),
          requireId(channelIds, op.updatesChannelKey, 'channel'),
        );
      case 'reorderChannels': {
        const positions: ChannelPosition[] = [];
        op.categoryKeys.forEach((key, position) => {
          const id = categoryIds.get(key);
          if (id) positions.push({ id, parentId: null, position });
        });
        for (const [categoryKey, keys] of Object.entries(op.channelKeys)) {
          const parentId = categoryIds.get(categoryKey) ?? null;
          keys.forEach((key, position) => {
            const id = channelIds.get(key);
            if (id) positions.push({ id, parentId, position });
          });
        }
        return port.setChannelPositions(positions);
      }
      case 'setAfk':
        return port.setAfk(requireId(channelIds, op.channelKey, 'channel'), op.timeoutSeconds);
      case 'setNicknameLock':
        return port.setEveryonePermissions(op.permissions);
      case 'upsertPanel': {
        const { panel } = op;
        const messageId = await port.upsertPanel(
          requireId(channelIds, panel.channelKey, 'channel'),
          op.messageId,
          { ...panel, description: linkChannels(panel.description, channelIds) },
        );
        store.set('message', panel.key, messageId, panel.fingerprint);
        return;
      }
      case 'deleteChannel':
      case 'deleteCategory': {
        await port.deleteChannel(op.id);
        store.delete(op.type === 'deleteChannel' ? 'channel' : 'category', op.key);
        return;
      }
      case 'deleteRole': {
        await port.deleteRole(op.id);
        store.delete('role', op.key);
        return;
      }
      case 'forgetMessage':
        store.delete('message', op.key);
        return;
    }
  };

  const result: ApplyResult = { applied: [], failures: [] };
  for (const op of plan.ops) {
    try {
      await run(op);
      result.applied.push(op);
    } catch (error) {
      result.failures.push({ op, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/** "{channel:general}" → "<#id>", so panel texts can link channels by their yaml key. */
export function linkChannels(text: string, channelIds: Map<string, string>): string {
  return text.replace(/\{channel:([a-z0-9-]+)\}/g, (match, key: string) => {
    const id = channelIds.get(key);
    return id ? `<#${id}>` : match;
  });
}

/** Which channels /setup must check for its panel messages before planning. */
export function panelMessagesToCheck(
  store: ManagedObjectStore,
  panels: { key: string; channelKey: string }[],
): { channelId: string; messageId: string }[] {
  return panels.flatMap((panel) => {
    const message = store.get('message', panel.key);
    const channel = store.get('channel', panel.channelKey);
    return message && channel
      ? [{ channelId: channel.discordId, messageId: message.discordId }]
      : [];
  });
}
