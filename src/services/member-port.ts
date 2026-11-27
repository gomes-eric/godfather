/** A member as the bot needs to see them, read fresh from Discord. */
export interface MemberSnapshot {
  id: string;
  displayName: string;
  roleIds: string[];
  isBot: boolean;
  isOwner: boolean;
  /** The bot's highest role is above the member's, so it may change their roles and nickname. */
  manageable: boolean;
  avatarUrl: string;
  joinedAt: Date | null;
  createdAt: Date;
  timeoutUntil: Date | null;
}

export interface MemberUpdate {
  roleIds: string[];
  nickname?: string;
}

/** The seam between the roster and Discord's members (a Discord adapter and an in-memory fake). */
export interface MemberPort {
  ownerId(): string;
  member(userId: string): Promise<MemberSnapshot | null>;
  roleMemberCount(roleId: string): number;
  /** The name Discord last showed for them, without asking it again (lists, summaries). */
  cachedName(userId: string): string | undefined;
  /** Roles and nickname in one write, so a second write never starts from a stale copy. */
  update(userId: string, change: MemberUpdate, reason: string): Promise<void>;
}
