export const NICKNAME_MAX = 32;

export function normalizeGameName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function registrationNickname(classEmoji: string, gameName: string): string {
  return `${classEmoji} ${gameName}`;
}

/**
 * The member's roles with exactly one class: every class role goes, then the chosen one is added
 * once. Discord rejects a role list that names the same role twice (someone registering again).
 */
export function rolesWithClass(
  currentRoleIds: readonly string[],
  classRoleId: string,
  allClassRoleIds: readonly string[],
): string[] {
  const classes = new Set([...allClassRoleIds, classRoleId]);
  return [...currentRoleIds.filter((id) => !classes.has(id)), classRoleId];
}
