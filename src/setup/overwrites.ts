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
  category: P.ViewChannel | P.ReadMessageHistory | P.Connect,
};

const WRITE: Record<Kind, bigint> = {
  text: P.SendMessages | P.SendMessagesInThreads | P.CreatePublicThreads,
  announcement: P.SendMessages | P.SendMessagesInThreads,
  forum: P.SendMessages | P.SendMessagesInThreads,
  voice: P.Speak | P.Stream,
  category: P.SendMessages | P.SendMessagesInThreads | P.CreatePublicThreads | P.Speak | P.Stream,
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
  /** Fixed allows on top of the access rules, e.g. the Bot role in every voice channel. */
  extraAllows?: { roleKey: string; allow: bigint }[];
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
  }

  for (const { roleKey, allow } of input.extraAllows ?? []) {
    entry(roleKey).allow |= allow;
  }

  // Never allow and deny the same bit on one target (e.g. view "everyone", write "everyone").
  return [...byTarget.entries()]
    .map(([target, { allow, deny }]) => ({ target, allow, deny: deny & ~allow }))
    .filter((o) => o.allow !== 0n || o.deny !== 0n)
    .sort((a, b) => a.target.localeCompare(b.target));
}
