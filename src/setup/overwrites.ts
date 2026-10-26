import { PermissionFlagsBits as P } from 'discord.js';
import type { AccessLevel, ChannelKind } from '../config/schema.js';
import type { RankedTier } from '../core/tiers.js';
import { EVERYONE, type DesiredOverwrite } from './model.js';

type Kind = ChannelKind | 'category';

// What "can see" and "can write" mean for each channel kind. Categories carry both text and
// voice permissions because the channels created under them (e.g. temporary voice rooms) inherit.
const VIEW: Record<Kind, bigint> = {
  text: P.ViewChannel | P.ReadMessageHistory,
  announcement: P.ViewChannel | P.ReadMessageHistory,
  forum: P.ViewChannel | P.ReadMessageHistory,
  voice: P.ViewChannel | P.Connect,
  stage: P.ViewChannel | P.Connect,
  category: P.ViewChannel | P.ReadMessageHistory | P.Connect,
};

// Writing includes starting threads, public or private: a read-only channel must not let
// people open a thread under a post.
const TEXT_WRITE =
  P.SendMessages | P.SendMessagesInThreads | P.CreatePublicThreads | P.CreatePrivateThreads;

const WRITE: Record<Kind, bigint> = {
  text: TEXT_WRITE,
  announcement: TEXT_WRITE,
  forum: P.SendMessages | P.SendMessagesInThreads,
  voice: P.Speak | P.Stream,
  // On a stage, "writing" means asking to speak; moderators bring speakers up.
  stage: P.RequestToSpeak,
  category: TEXT_WRITE | P.Speak | P.Stream,
};

const TIER_LEVELS: Record<RankedTier, number> = { soldier: 1, officer: 2, commander: 3 };
const LEVEL_RANK: Record<AccessLevel, number> = {
  everyone: 0,
  soldier: 1,
  officer: 2,
  commander: 3,
  bot: 4,
  none: 4,
};

/** @everyone's base permissions with ChangeNickname removed (locked) or granted (unlocked). */
export function lockedNicknamePermissions(current: bigint, locked: boolean): bigint {
  return locked ? current & ~P.ChangeNickname : current | P.ChangeNickname;
}

export interface AccessRule {
  level: AccessLevel;
  permissions: bigint;
}

export interface OverwriteInput {
  kind: Kind;
  view: AccessLevel;
  write: AccessLevel;
  /** Extra level for slash commands (e.g. #musica: nobody writes, soldiers run commands). */
  slashCommands?: AccessLevel;
  /** Role key per tier, e.g. { soldier: "soldier" }. */
  tierRoleKeys: Partial<Record<RankedTier, string>>;
  /** Roles that get whatever the soldier tier gets here (server.yaml `asSoldier`). */
  asSoldierRoleKeys?: string[];
  /** Fixed allows on top of the access rules, e.g. the Bot role in every voice channel. */
  extraAllows?: { roleKey: string; allow: bigint }[];
  /** Fixed denies on top of the access rules, from a channel's `deny` in server.yaml. */
  extraDenies?: { roleKey: string; deny: bigint }[];
}

/**
 * Turns access levels into permission overwrites:
 * - `everyone`: allowed explicitly on @everyone.
 * - a tier: denied on @everyone, allowed on that tier's role and every role above it.
 * - `bot` / `none`: denied on @everyone with no allows (Padrinho is Administrator).
 */
export function computeOverwrites(input: OverwriteInput): DesiredOverwrite[] {
  const byTarget = new Map<string, { allow: bigint; deny: bigint }>();
  const entry = (target: string) => {
    let current = byTarget.get(target);
    if (!current) byTarget.set(target, (current = { allow: 0n, deny: 0n }));
    return current;
  };

  const rules: AccessRule[] = [
    { level: input.view, permissions: VIEW[input.kind] },
    { level: input.write, permissions: WRITE[input.kind] },
  ];
  if (input.slashCommands) {
    rules.push({ level: input.slashCommands, permissions: P.UseApplicationCommands });
  }

  for (const { level, permissions } of rules) {
    if (level === 'everyone') {
      entry(EVERYONE).allow |= permissions;
      continue;
    }
    entry(EVERYONE).deny |= permissions;
    for (const [tier, roleKey] of Object.entries(input.tierRoleKeys) as [RankedTier, string][]) {
      if (TIER_LEVELS[tier] >= LEVEL_RANK[level]) entry(roleKey).allow |= permissions;
    }
    if (level === 'soldier') {
      for (const roleKey of input.asSoldierRoleKeys ?? []) entry(roleKey).allow |= permissions;
    }
  }

  for (const { roleKey, allow } of input.extraAllows ?? []) {
    entry(roleKey).allow |= allow;
  }
  // A fixed deny wins over what the access rules gave that role.
  for (const { roleKey, deny } of input.extraDenies ?? []) {
    const target = entry(roleKey);
    target.allow &= ~deny;
    target.deny |= deny;
  }

  // Never allow and deny the same bit on one target (e.g. view "everyone", write "everyone").
  return [...byTarget.entries()]
    .map(([target, { allow, deny }]) => ({ target, allow, deny: deny & ~allow }))
    .filter((o) => o.allow !== 0n || o.deny !== 0n)
    .sort((a, b) => a.target.localeCompare(b.target));
}
