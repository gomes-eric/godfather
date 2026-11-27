import { TIER_RANK, tierAtLeast, type Tier } from './tiers.js';

export interface ActionPolicy {
  minTier: Tier;
  destructive: boolean;
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

export const ACTION_POLICIES = {
  'member.ban': policy('commander', { destructive: true }),
  'member.unban': policy('commander'),
  'member.kick': policy('officer', { destructive: true }),
  'member.timeout': policy('officer'),
  'member.promote': policy('officer'),
  'member.demote': policy('officer', { destructive: true }),
  'member.partner': policy('officer'),
  'member.ally': policy('officer'),
  'member.restrict': policy('officer'),
  'alliance.add': policy('commander'),
  'alliance.remove': policy('commander', { destructive: true }),
  'alliance.read': policy('soldier', { audited: false }),
  'alliance.leader': policy('officer'),
  'member.sync': policy('commander'),
  'member.read': policy('officer', { audited: false }),
  'member.register': policy('officer'),

  'server.read': policy('officer', { audited: false }),
  'channel.create': policy('commander'),
  'channel.edit': policy('commander'),
  'channel.delete': policy('commander', { destructive: true }),
  'role.create': policy('commander'),
  'role.edit': policy('commander'),
  'role.delete': policy('commander', { destructive: true }),
  'role.assign': policy('commander'),
  'character.read': policy('visitor', { audited: false }),
  'recruit.apply': policy('visitor', { audited: false }),
  'recruit.decide': policy('officer'),
  'recruit.kind': policy('officer'),
  'recruit.read': policy('officer', { audited: false }),
  'legion.check': policy('officer'),
  'news.preview': policy('officer'),

  'party.create': policy('soldier', { audited: false }),
  'party.join': policy('soldier', { audited: false }),
  'party.leave': policy('soldier', { audited: false }),
  'party.close': policy('soldier', { audited: false }),
  'party.close.any': policy('officer', { audited: false }),

  'message.send': policy('officer'),
  'message.purge': policy('officer', { destructive: true }),
  'message.read': policy('officer', { audited: false }),

  'event.create': policy('officer'),
  'event.edit': policy('officer'),
  'event.cancel': policy('officer', { destructive: true }),
  'event.template.edit': policy('officer'),
  'event.rsvp': policy('soldier', { audited: false }),
  'event.rsvps.read': policy('officer', { audited: false }),
  'event.read': policy('soldier', { audited: false }),

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

export function authorize(tier: Tier, action: ActionName): Authorization {
  const { minTier } = ACTION_POLICIES[action];
  return tierAtLeast(tier, minTier) ? { allowed: true } : { allowed: false, requiredTier: minTier };
}

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
