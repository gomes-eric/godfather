import { TIER_RANK, tierAtLeast, type Tier } from './tiers.js';

export interface ActionPolicy {
  minTier: Tier;
  /** Requires `confirm: true`; without it the action only returns a preview (PLAN.md §5.3). */
  destructive: boolean;
  /** Whether the action is written to the audit log. Reads and self-service clicks are not. */
  audited: boolean;
}

function policy(
  minTier: Tier,
  options: { destructive?: boolean; audited?: boolean } = {},
): ActionPolicy {
  return {
    minTier,
    destructive: options.destructive ?? false,
    audited: options.audited ?? true,
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
  'member.partner': policy('officer'),
  // The daily legion check updating a member's class role and nickname (the bot itself).
  'member.sync': policy('commander'),
  'member.read': policy('officer', { audited: false }),

  'channel.create': policy('commander'),
  'channel.edit': policy('commander'),
  'channel.delete': policy('commander', { destructive: true }),
  'role.create': policy('commander'),
  'role.edit': policy('commander'),
  'role.delete': policy('commander', { destructive: true }),
  'role.assign': policy('commander'),
  // Self-service class buttons in #escolha-seu-cargo: open to everyone and too noisy to audit.
  'member.register': policy('visitor', { audited: false }),
  'character.read': policy('visitor', { audited: false }),
  // Recruitment: a Visitante applies; an officer approves (registers them, makes them Soldado).
  'recruit.apply': policy('visitor', { audited: false }),
  'recruit.decide': policy('officer'),

  // Party finder: anyone in the legion opens and joins groups; the leader or an officer closes.
  'party.create': policy('soldier', { audited: false }),
  'party.join': policy('soldier', { audited: false }),
  'party.close': policy('soldier', { audited: false }),

  'message.send': policy('officer'),
  'message.edit': policy('officer'),
  'message.delete': policy('officer'),
  'message.purge': policy('officer', { destructive: true }),
  'message.read': policy('officer', { audited: false }),

  'event.create': policy('officer'),
  'event.edit': policy('officer'),
  'event.cancel': policy('officer', { destructive: true }),
  'event.template.edit': policy('officer'),
  // RSVP clicks are self-service and too noisy for #audit-log.
  'event.rsvp': policy('soldier', { audited: false }),
  'event.rsvps.read': policy('officer', { audited: false }),
  'event.read': policy('soldier', { audited: false }),

  'boss.read': policy('soldier', { audited: false }),
  'boss.override': policy('officer'),

  // Self-service on your own room: owning it is the real check (VoiceService), so Parceiros
  // can run their Social rooms. Not audited, like other self-service clicks; an officer acting
  // on someone else's room (voice.temp.manage) still is.
  'voice.own.manage': policy('visitor', { audited: false }),
  'voice.temp.manage': policy('officer'),
  'voice.generator.upsert': policy('commander'),
  'voice.generator.delete': policy('commander', { destructive: true }),

  'setup.plan': policy('commander', { audited: false }),
  'setup.apply': policy('commander', { destructive: true }),
  'config.reload': policy('commander'),

  'mcp.token.create': policy('officer'),
  'mcp.token.revoke.own': policy('officer'),
  'mcp.token.revoke.any': policy('commander'),

  'audit.read': policy('officer', { audited: false }),
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
 * The server owner (Fundador) sits above every tier, so only the owner makes or unmakes Comandantes.
 */
export function canChangeTier(
  actorTier: Tier,
  currentTier: Tier,
  newTier: Tier,
  actorIsOwner = false,
): boolean {
  if (actorIsOwner) return true;
  const actorRank = TIER_RANK[actorTier];
  return TIER_RANK[currentTier] < actorRank && TIER_RANK[newTier] < actorRank;
}
