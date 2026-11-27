export interface MemberSnapshot {
  id: string;
  bot: boolean;
  roleIds: readonly string[];
}

export interface AutoRoles {
  /** welcome.autoRole, for a person with no place in the server yet. */
  visitor?: string | undefined;
  /** welcome.botRole, for every bot but Padrinho. */
  bot?: string | undefined;
  /** Roles that already give a person a place: standing, alliance and soldier-like roles. */
  placed: ReadonlySet<string>;
}

export interface AutoRoleGrant {
  memberId: string;
  roleId: string;
  kind: 'bot' | 'visitor';
}

export function planAutoRoles(
  members: Iterable<MemberSnapshot>,
  roles: AutoRoles,
  botId: string,
): AutoRoleGrant[] {
  const grants: AutoRoleGrant[] = [];
  for (const member of members) {
    const has = (id: string) => member.roleIds.includes(id);
    if (member.bot) {
      if (roles.bot && member.id !== botId && !has(roles.bot)) {
        grants.push({ memberId: member.id, roleId: roles.bot, kind: 'bot' });
      }
    } else if (
      roles.visitor &&
      !has(roles.visitor) &&
      !member.roleIds.some((id) => roles.placed.has(id))
    ) {
      grants.push({ memberId: member.id, roleId: roles.visitor, kind: 'visitor' });
    }
  }
  return grants;
}
