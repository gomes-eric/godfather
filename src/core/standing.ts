import { canChangeTier } from './permissions.js';
import type { RankedTier, Tier, TierRoleIds } from './tiers.js';

// A member's standing in the server: one rank of the legion's ladder, or one of the roles outside
// it (an ally of another legion, a partner who doesn't play, someone restricted, a visitor). A
// member has exactly one; changing it swaps every standing role at once and keeps the rest
// (class roles, Bot...).

export type Standing =
  | { kind: 'tier'; tier: RankedTier }
  /** `alliance` is the alliance's key in server.yaml. */
  | { kind: 'ally'; alliance: string }
  | { kind: 'partner' }
  | { kind: 'restricted' }
  | { kind: 'visitor' };

export const VISITOR: Standing = { kind: 'visitor' };
export const PARTNER: Standing = { kind: 'partner' };
export const RESTRICTED: Standing = { kind: 'restricted' };
export const SOLDIER: Standing = { kind: 'tier', tier: 'soldier' };
export const allyOf = (alliance: string): Standing => ({ kind: 'ally', alliance });

/** The role ids behind each standing; a role not created yet is missing. */
export interface StandingRoles {
  tiers: TierRoleIds;
  visitor?: string | undefined;
  partner?: string | undefined;
  restricted?: string | undefined;
  ally?: string | undefined;
  /** Alliance key → the role named after its legion. */
  alliances: Record<string, string>;
}

const RANKED: RankedTier[] = ['commander', 'officer', 'soldier'];

/** The standing the member's roles give: the highest rank first, then ally, partner, restricted. */
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

/** The permission tier a standing acts with: an ally counts as Soldado, the rest as Visitante. */
export function standingTier(standing: Standing): Tier {
  if (standing.kind === 'tier') return standing.tier;
  return standing.kind === 'ally' ? 'soldier' : 'visitor';
}

export function sameStanding(a: Standing, b: Standing): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'tier' && b.kind === 'tier') return a.tier === b.tier;
  if (a.kind === 'ally' && b.kind === 'ally') return a.alliance === b.alliance;
  return true;
}

/** Every role id that marks a standing. */
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

/**
 * The member's roles after moving to `standing`: every standing role goes, then the new one is
 * added. Null when a role the new standing needs does not exist (run /setup).
 */
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
      return add(roles.ally, roles.alliances[standing.alliance]);
    case 'partner':
      return add(roles.partner);
    case 'restricted':
      return add(roles.restricted);
    case 'visitor':
      return roles.visitor ? [...kept, roles.visitor] : kept;
  }
}

/** Stored form, e.g. in an application: "soldier", "partner", "ally:ally-noxus". */
export function encodeStanding(standing: Standing): string {
  if (standing.kind === 'tier') return standing.tier;
  return standing.kind === 'ally' ? `ally:${standing.alliance}` : standing.kind;
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

/**
 * Whether `actor` may move the member to `to`. The rank rule of promotions applies: the member's
 * current and new tiers (an ally counts as Soldado) must both sit below the actor's own, unless the
 * actor owns the server. Nobody moves a bot, the owner or themselves.
 */
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
