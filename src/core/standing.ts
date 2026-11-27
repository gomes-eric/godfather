import { canChangeTier } from './permissions.js';
import type { RankedTier, Tier, TierRoleIds } from './tiers.js';

export type Standing =
  | { kind: 'tier'; tier: RankedTier }
  | { kind: 'ally'; allianceKey: string }
  | { kind: 'partner' }
  | { kind: 'restricted' }
  | { kind: 'visitor' };

export const VISITOR: Standing = { kind: 'visitor' };
export const PARTNER: Standing = { kind: 'partner' };
export const RESTRICTED: Standing = { kind: 'restricted' };
export const SOLDIER: Standing = { kind: 'tier', tier: 'soldier' };
export const allyOf = (allianceKey: string): Standing => ({ kind: 'ally', allianceKey });

export interface StandingRoles {
  tiers: TierRoleIds;
  visitor?: string | undefined;
  partner?: string | undefined;
  restricted?: string | undefined;
  ally?: string | undefined;
  alliances: Record<string, string>;
}

const RANKED: RankedTier[] = ['commander', 'officer', 'soldier'];

export function standingOf(
  roleIds: Iterable<string>,
  roles: StandingRoles,
  isOwner = false,
): Standing {
  if (isOwner) return { kind: 'tier', tier: 'commander' };
  const has = new Set(roleIds);
  const tier = RANKED.find((rank) => {
    const id = roles.tiers[rank];
    return id !== undefined && has.has(id);
  });
  if (tier) return { kind: 'tier', tier };
  const alliance = Object.entries(roles.alliances).find(([, id]) => has.has(id))?.[0];
  if (alliance !== undefined || (roles.ally !== undefined && has.has(roles.ally))) {
    return allyOf(alliance ?? '');
  }
  if (roles.partner !== undefined && has.has(roles.partner)) return PARTNER;
  if (roles.restricted !== undefined && has.has(roles.restricted)) return RESTRICTED;
  return VISITOR;
}

export function standingTier(standing: Standing): Tier {
  if (standing.kind === 'tier') return standing.tier;
  return standing.kind === 'ally' ? 'soldier' : 'visitor';
}

export function ladderTier(standing: Standing): Tier {
  return standing.kind === 'tier' ? standing.tier : 'visitor';
}

export function sameStanding(a: Standing, b: Standing): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'tier' && b.kind === 'tier') return a.tier === b.tier;
  if (a.kind === 'ally' && b.kind === 'ally') return a.allianceKey === b.allianceKey;
  return true;
}

function standingRoleIds(roles: StandingRoles): Set<string> {
  return new Set(
    [
      ...Object.values(roles.tiers),
      roles.visitor,
      roles.partner,
      roles.restricted,
      roles.ally,
      ...Object.values(roles.alliances),
    ].filter((id): id is string => id !== undefined),
  );
}

export function rolesForStanding(
  currentRoleIds: readonly string[],
  standing: Standing,
  roles: StandingRoles,
): string[] | null {
  const marks = standingRoleIds(roles);
  const kept = currentRoleIds.filter((id) => !marks.has(id));
  const add = (...ids: (string | undefined)[]) =>
    ids.every((id) => id !== undefined) ? [...kept, ...(ids as string[])] : null;
  switch (standing.kind) {
    case 'tier':
      return add(roles.tiers[standing.tier]);
    case 'ally':
      return add(roles.ally, roles.alliances[standing.allianceKey]);
    case 'partner':
      return add(roles.partner);
    case 'restricted':
      return add(roles.restricted);
    case 'visitor':
      return roles.visitor ? [...kept, roles.visitor] : kept;
  }
}

export function encodeStanding(standing: Standing): string {
  if (standing.kind === 'tier') return standing.tier;
  return standing.kind === 'ally' ? `ally:${standing.allianceKey}` : standing.kind;
}

export function decodeStanding(value: string): Standing {
  if (value === 'soldier' || value === 'officer' || value === 'commander') {
    return { kind: 'tier', tier: value };
  }
  if (value.startsWith('ally:')) return allyOf(value.slice('ally:'.length));
  if (value === 'partner') return PARTNER;
  if (value === 'restricted') return RESTRICTED;
  return VISITOR;
}

export type StandingRefusal =
  'targetIsBot' | 'targetIsOwner' | 'targetIsSelf' | 'alreadyThere' | 'cannotManageTier';

export function decideStandingChange(input: {
  actorTier: Tier;
  actorId: string;
  actorIsOwner?: boolean;
  targetId: string;
  targetIsBot: boolean;
  targetIsOwner: boolean;
  from: Standing;
  to: Standing;
}): StandingRefusal | null {
  if (input.targetIsBot) return 'targetIsBot';
  if (input.targetIsOwner) return 'targetIsOwner';
  if (input.targetId === input.actorId) return 'targetIsSelf';
  if (sameStanding(input.from, input.to)) return 'alreadyThere';
  const allowed = canChangeTier(
    input.actorTier,
    standingTier(input.from),
    standingTier(input.to),
    input.actorIsOwner,
  );
  return allowed ? null : 'cannotManageTier';
}
