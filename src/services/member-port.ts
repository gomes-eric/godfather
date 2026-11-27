export interface MemberSnapshot {
  id: string;
  displayName: string;
  roleIds: string[];
  isBot: boolean;
  isOwner: boolean;
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

export interface MemberPort {
  ownerId(): string;
  member(userId: string): Promise<MemberSnapshot | null>;
  roleMemberCount(roleId: string): number;
  cachedName(userId: string): string | undefined;
  update(userId: string, change: MemberUpdate, reason: string): Promise<void>;
}
