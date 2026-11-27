export const TIERS = ['visitor', 'soldier', 'officer', 'commander'] as const;

export type Tier = (typeof TIERS)[number];

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
