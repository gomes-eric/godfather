import { canChangeTier } from './permissions.js';
import { TIER_RANK, TIERS, type Tier } from './tiers.js';

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
  actorIsOwner?: boolean;
  rank?: Tier;
  officerCount: number;
  maxOfficers?: number;
}

function checkTarget(
  input: Pick<TierChangeInput, 'actorId' | 'targetId' | 'targetIsBot' | 'targetIsOwner'>,
): 'targetIsBot' | 'targetIsOwner' | 'targetIsSelf' | null {
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
  if (!canChangeTier(input.actorTier, input.targetTier, to, input.actorIsOwner)) {
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
  if (!canChangeTier(input.actorTier, input.targetTier, to, input.actorIsOwner)) {
    return { ok: false, refusal: 'cannotManageTier' };
  }
  return { ok: true, to };
}

export type ModerationRefusal = 'targetIsBot' | 'targetIsOwner' | 'targetIsSelf' | 'targetTooHigh';

export function checkModerationTarget(input: {
  actorTier: Tier;
  actorId: string;
  targetId: string;
  targetTier: Tier;
  targetIsBot: boolean;
  targetIsOwner: boolean;
}): ModerationRefusal | null {
  const refusal = checkTarget(input);
  if (refusal) return refusal;
  if (TIER_RANK[input.targetTier] >= TIER_RANK[input.actorTier]) return 'targetTooHigh';
  return null;
}
