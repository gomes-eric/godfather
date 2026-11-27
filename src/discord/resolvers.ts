import {
  ChannelType,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Role,
} from 'discord.js';
import { resolveCandidate, type Candidate } from '../core/resolve.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { ChannelView, MemberView, RoleView } from '../services/guild-admin-port.js';
import type { SnapshotChannelKind } from '../setup/model.js';

export type Found<T> = { ok: true; value: T } | { ok: false; reason: string };

const t = ptBR.resolve;

function found<T>(
  what: keyof typeof t.what,
  input: string,
  candidates: Candidate[],
  get: (id: string) => T | undefined,
): Found<T> {
  const result = resolveCandidate(input, candidates);
  if (result.ok) {
    const value = get(result.id);
    if (value) return { ok: true, value };
  }
  if (!result.ok && result.reason === 'ambiguous') {
    return { ok: false, reason: t.ambiguous(t.what[what], input, result.options) };
  }
  return { ok: false, reason: t.none(t.what[what], input) };
}

export function findMember(guild: Guild, input: string): Found<GuildMember> {
  const candidates = [...guild.members.cache.values()].map((m) => ({
    id: m.id,
    names: [m.user.username, m.displayName, m.user.globalName ?? '', m.nickname ?? ''].filter(
      Boolean,
    ),
    label: `${m.displayName} (@${m.user.username})`,
  }));
  return found('member', input, candidates, (id) => guild.members.cache.get(id));
}

const KIND_LABEL: Partial<Record<ChannelType, string>> = {
  [ChannelType.GuildVoice]: '🔊 ',
  [ChannelType.GuildStageVoice]: '🎙️ ',
  [ChannelType.GuildCategory]: '📁 ',
  [ChannelType.GuildForum]: '📋 ',
};

export function findChannel(
  guild: Guild,
  input: string,
  filter: (channel: GuildBasedChannel) => boolean = () => true,
  what: 'channel' | 'category' = 'channel',
): Found<GuildBasedChannel> {
  const candidates = [...guild.channels.cache.values()].filter(filter).map((c) => ({
    id: c.id,
    names: [c.name],
    label: `${KIND_LABEL[c.type] ?? '#'}${c.name}`,
  }));
  return found(what, input, candidates, (id) => guild.channels.cache.get(id));
}

export function findCategory(guild: Guild, input: string): Found<GuildBasedChannel> {
  return findChannel(guild, input, (c) => c.type === ChannelType.GuildCategory, 'category');
}

export function findRole(guild: Guild, input: string): Found<Role> {
  const candidates = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id)
    .map((r) => ({ id: r.id, names: [r.name], label: r.name }));
  return found('role', input, candidates, (id) => guild.roles.cache.get(id));
}

const byId = <T extends { id: string }>(items: T[]) => {
  const map = new Map(items.map((item) => [item.id, item]));
  return (id: string) => map.get(id);
};

export function pickMember(members: MemberView[], input: string): Found<MemberView> {
  const candidates = members.map((m) => ({
    id: m.id,
    names: [m.username, m.displayName, m.globalName ?? '', m.nickname ?? ''].filter(Boolean),
    label: `${m.displayName} (@${m.username})`,
  }));
  return found('member', input, candidates, byId(members));
}

const VIEW_KIND_LABEL: Partial<Record<SnapshotChannelKind, string>> = {
  voice: '🔊 ',
  stage: '🎙️ ',
  category: '📁 ',
  forum: '📋 ',
};

export function pickChannel(
  channels: ChannelView[],
  input: string,
  filter: (channel: ChannelView) => boolean = () => true,
  what: 'channel' | 'category' = 'channel',
): Found<ChannelView> {
  const eligible = channels.filter(filter);
  const candidates = eligible.map((c) => ({
    id: c.id,
    names: [c.name],
    label: `${VIEW_KIND_LABEL[c.kind] ?? '#'}${c.name}`,
  }));
  return found(what, input, candidates, byId(eligible));
}

export function pickRole(roles: RoleView[], input: string): Found<RoleView> {
  const candidates = roles.map((r) => ({ id: r.id, names: [r.name], label: r.name }));
  return found('role', input, candidates, byId(roles));
}
