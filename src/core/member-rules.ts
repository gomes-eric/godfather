import { canChangeTier } from './permissions.js';
import { TIER_RANK, TIERS, type Tier } from './tiers.js';

// Pure decisions behind /member and /mod (PLAN.md §5.2, §6.2, §6.8). The services only fetch
// Discord state, ask these functions, and carry out the answer.

export type MemberRefusal =
  | 'targetIsBot'
  | 'targetIsOwner'
  | 'targetIsSelf'
  | 'alreadyTop'
  | 'alreadyBottom'
  | 'notHigher'
  | 'notLower'
  | 'cannotManageTier'
  | 'officerLimit';

export type TierDecision = { ok: true; to: Tier } | { ok: false; refusal: MemberRefusal };

interface TierChangeInput {
  actorTier: Tier;
  actorId: string;
  targetId: string;
  targetTier: Tier;
  targetIsBot: boolean;
  targetIsOwner: boolean;
  /** Explicit rank; defaults to one step up (promote) or down (demote). */
  rank?: Tier;
  officerCount: number;
  maxOfficers?: number;
}

function checkTarget(input: TierChangeInput): MemberRefusal | null {
  if (input.targetIsBot) return 'targetIsBot';
  if (input.targetIsOwner) return 'targetIsOwner';
  if (input.targetId === input.actorId) return 'targetIsSelf';
  return null;
}

export function decidePromotion(input: TierChangeInput): TierDecision {
  const refusal = checkTarget(input);
  if (refusal) return { ok: false, refusal };

  const current = TIER_RANK[input.targetTier];
  const to = input.rank ?? TIERS[current + 1];
  if (!to) return { ok: false, refusal: 'alreadyTop' };
  if (TIER_RANK[to] <= current) return { ok: false, refusal: 'notHigher' };
  if (!canChangeTier(input.actorTier, input.targetTier, to)) {
    return { ok: false, refusal: 'cannotManageTier' };
  }
  if (
    to === 'officer' &&
    input.maxOfficers !== undefined &&
    input.officerCount >= input.maxOfficers
  ) {
    return { ok: false, refusal: 'officerLimit' };
  }
  return { ok: true, to };
}

export function decideDemotion(input: TierChangeInput): TierDecision {
  const refusal = checkTarget(input);
  if (refusal) return { ok: false, refusal };

  const current = TIER_RANK[input.targetTier];
  const to = input.rank ?? (current > 0 ? TIERS[current - 1] : undefined);
  if (!to) return { ok: false, refusal: 'alreadyBottom' };
  if (TIER_RANK[to] >= current) return { ok: false, refusal: 'notLower' };
  if (!canChangeTier(input.actorTier, input.targetTier, to)) {
    return { ok: false, refusal: 'cannotManageTier' };
  }
  return { ok: true, to };
}

export type ModerationRefusal = 'targetIsBot' | 'targetIsOwner' | 'targetIsSelf' | 'targetTooHigh';

/** Kick/ban/timeout: only members strictly below the actor's tier (officers can't kick officers). */
export function checkModerationTarget(input: {
  actorTier: Tier;
  actorId: string;
  targetId: string;
  targetTier: Tier;
  targetIsBot: boolean;
  targetIsOwner: boolean;
}): ModerationRefusal | null {
  if (input.targetIsBot) return 'targetIsBot';
  if (input.targetIsOwner) return 'targetIsOwner';
  if (input.targetId === input.actorId) return 'targetIsSelf';
  if (TIER_RANK[input.targetTier] >= TIER_RANK[input.actorTier]) return 'targetTooHigh';
  return null;
}

/**
 * Roles a member should have after moving to `to`: every tier role (and Visitante) removed,
 * then the new tier's role added. Other roles (classes, Bot) are kept.
 */
export type PartnerRefusal =
  'targetIsBot' | 'targetIsOwner' | 'targetIsSelf' | 'alreadyPartner' | 'notPartner' | 'inLegion';

/**
 * Parceiro is for people who don't play: only someone outside the legion (Visitante) can become
 * one, and removing it sends them back to Visitante.
 */
export function decidePartner(input: {
  actorId: string;
  targetId: string;
  targetIsBot: boolean;
  targetIsOwner: boolean;
  targetTier: Tier;
  isPartner: boolean;
  remove: boolean;
}): PartnerRefusal | null {
  if (input.targetIsBot) return 'targetIsBot';
  if (input.targetIsOwner) return 'targetIsOwner';
  if (input.targetId === input.actorId) return 'targetIsSelf';
  if (input.remove) return input.isPartner ? null : 'notPartner';
  if (input.isPartner) return 'alreadyPartner';
  if (input.targetTier !== 'visitor') return 'inLegion';
  return null;
}

/** Roles after giving or taking Parceiro: it swaps with Visitante. */
export function rolesForPartner(
  currentRoleIds: string[],
  partnerRoleId: string,
  visitorRoleId: string | undefined,
  remove: boolean,
): string[] {
  const kept = currentRoleIds.filter((id) => id !== partnerRoleId && id !== visitorRoleId);
  if (remove) return visitorRoleId ? [...kept, visitorRoleId] : kept;
  return [...kept, partnerRoleId];
}

/**
 * Roles for someone the game shows in the legion: Soldado in place of Visitante, and Parceiro
 * dropped (it is for people who don't play).
 */
export function rolesForAdmission(
  currentRoleIds: string[],
  partnerRoleId: string | undefined,
  tierRoles: Partial<Record<Tier, string>>,
): string[] {
  return rolesForTier(
    currentRoleIds.filter((id) => id !== partnerRoleId),
    'soldier',
    tierRoles,
  );
}

export function rolesForTier(
  currentRoleIds: string[],
  to: Tier,
  tierRoles: Partial<Record<Tier, string>>,
): string[] {
  const tierRoleIds = new Set(Object.values(tierRoles));
  const kept = currentRoleIds.filter((id) => !tierRoleIds.has(id));
  const newRole = tierRoles[to];
  return newRole ? [...kept, newRole] : kept;
}
