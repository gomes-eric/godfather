// Permission tiers, lowest to highest (PLAN.md §5.1).
export const TIERS = ['visitor', 'soldier', 'officer', 'commander'] as const;

export type Tier = (typeof TIERS)[number];

/** Tiers that map to a Discord role. Visitors are anyone without one of these roles. */
export type RankedTier = Exclude<Tier, 'visitor'>;

export type TierRoleIds = Partial<Record<RankedTier, string>>;

export const TIER_RANK: Record<Tier, number> = {
  visitor: 0,
  soldier: 1,
  officer: 2,
  commander: 3,
};

export function tierAtLeast(tier: Tier, minimum: Tier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[minimum];
}

/** Highest tier among the member's roles. The server owner is always a commander. */
export function resolveTier(
  member: { roleIds: Iterable<string>; isOwner: boolean },
  tierRoleIds: TierRoleIds,
): Tier {
  if (member.isOwner) return 'commander';

  const roleIds = new Set(member.roleIds);
  const ranked: RankedTier[] = ['commander', 'officer', 'soldier'];
  return (
    ranked.find((tier) => {
      const roleId = tierRoleIds[tier];
      return roleId !== undefined && roleIds.has(roleId);
    }) ?? 'visitor'
  );
}
