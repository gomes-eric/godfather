// Pure rules for registering a character: the in-game name and main class become the nickname,
// e.g. "⚔️ Padrinho" (Discord allows 32 characters).

export const NICKNAME_MAX = 32;

/** Letters (any accent), digits, spaces and . _ ' - ; must start with a letter or digit. */
const GAME_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u;

export type GameNameProblem = 'empty' | 'tooLong' | 'invalid';

/** Trims and collapses inner spaces: "  Padrinho   Jr " → "Padrinho Jr". */
export function normalizeGameName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function registrationNickname(classEmoji: string, gameName: string): string {
  return `${classEmoji} ${gameName}`;
}

/** Why this name can't be used with this class emoji, or null if it can. */
export function checkGameName(gameName: string, classEmoji: string): GameNameProblem | null {
  if (gameName.length === 0) return 'empty';
  if (registrationNickname(classEmoji, gameName).length > NICKNAME_MAX) return 'tooLong';
  if (!GAME_NAME.test(gameName)) return 'invalid';
  return null;
}

/** "⚔️ Padrinho" → "Padrinho" when the nickname starts with one of the class emojis. */
export function stripClassEmoji(nickname: string, classEmojis: readonly string[]): string {
  for (const emoji of classEmojis) {
    if (nickname.startsWith(`${emoji} `)) return nickname.slice(emoji.length + 1);
  }
  return nickname;
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
