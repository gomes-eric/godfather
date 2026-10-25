import { TIER_RANK, tierAtLeast, type Tier } from './tiers.js';

export interface ActionPolicy {
  minTier: Tier;
  /** Requires `confirm: true`; without it the action only returns a preview (PLAN.md §5.3). */
  destructive: boolean;
  /** Read-only actions are authorized but not written to the audit log. */
  readOnly: boolean;
}

function policy(
  minTier: Tier,
  options: { destructive?: boolean; readOnly?: boolean } = {},
): ActionPolicy {
  return {
    minTier,
    destructive: options.destructive ?? false,
    readOnly: options.readOnly ?? false,
  };
}

// Action matrix (PLAN.md §5.2). Shared by slash commands and MCP tools.
export const ACTION_POLICIES = {
  'member.ban': policy('commander', { destructive: true }),
  'member.unban': policy('commander'),
  'member.kick': policy('officer', { destructive: true }),
  'member.timeout': policy('officer'),
  'member.promote': policy('officer'),
  'member.demote': policy('officer', { destructive: true }),
  'member.read': policy('officer', { readOnly: true }),

  'channel.create': policy('commander'),
  'channel.edit': policy('commander'),
  'channel.delete': policy('commander', { destructive: true }),
  'role.create': policy('commander'),
  'role.edit': policy('commander'),
  'role.delete': policy('commander', { destructive: true }),
  'role.assign': policy('commander'),

  'message.send': policy('officer'),
  'message.edit': policy('officer'),
  'message.delete': policy('officer'),
  'message.purge': policy('officer', { destructive: true }),
  'message.read': policy('officer', { readOnly: true }),

  'event.create': policy('officer'),
  'event.edit': policy('officer'),
  'event.cancel': policy('officer', { destructive: true }),
  'event.template.edit': policy('officer'),
  'event.rsvp': policy('soldier'),
  'event.read': policy('soldier', { readOnly: true }),

  'boss.read': policy('soldier', { readOnly: true }),
  'boss.override': policy('officer'),

  'voice.own.manage': policy('soldier'),
  'voice.temp.manage': policy('officer'),
  'voice.generator.upsert': policy('commander'),
  'voice.generator.delete': policy('commander', { destructive: true }),

  'setup.plan': policy('commander', { readOnly: true }),
  'setup.apply': policy('commander', { destructive: true }),
  'config.reload': policy('commander'),

  'mcp.token.create': policy('officer'),
  'mcp.token.revoke.own': policy('officer'),
  'mcp.token.revoke.any': policy('commander'),

  'audit.read': policy('officer', { readOnly: true }),
} as const satisfies Record<string, ActionPolicy>;

export type ActionName = keyof typeof ACTION_POLICIES;

export type Authorization = { allowed: true } | { allowed: false; requiredTier: Tier };

export function getPolicy(action: ActionName): ActionPolicy {
  return ACTION_POLICIES[action];
}

export function authorize(tier: Tier, action: ActionName): Authorization {
  const { minTier } = ACTION_POLICIES[action];
  return tierAtLeast(tier, minTier) ? { allowed: true } : { allowed: false, requiredTier: minTier };
}

/**
 * Promotion/demotion rule: an actor may only move members whose current and new tiers are both
 * strictly below their own. Officers manage soldiers and visitors; the commander manages officers.
 */
export function canChangeTier(actorTier: Tier, currentTier: Tier, newTier: Tier): boolean {
  const actorRank = TIER_RANK[actorTier];
  return TIER_RANK[currentTier] < actorRank && TIER_RANK[newTier] < actorRank;
}
