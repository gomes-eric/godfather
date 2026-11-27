import type { MemberPort, MemberSnapshot, MemberUpdate } from '../member-port.js';

export class FakeMembers implements MemberPort {
  readonly writes: ({ userId: string; reason: string } & MemberUpdate)[] = [];
  private readonly members = new Map<string, MemberSnapshot>();

  constructor(private readonly owner = 'owner') {}

  add(member: Partial<MemberSnapshot> & { id: string }): this {
    this.members.set(member.id, {
      displayName: member.id,
      roleIds: [],
      isBot: false,
      isOwner: member.id === this.owner,
      manageable: true,
      avatarUrl: `https://cdn.example/${member.id}.png`,
      joinedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      timeoutUntil: null,
      ...member,
    });
    return this;
  }

  remove(userId: string): this {
    this.members.delete(userId);
    return this;
  }

  roles(userId: string): string[] {
    return this.members.get(userId)?.roleIds ?? [];
  }

  nickname(userId: string): string | undefined {
    return [...this.writes].reverse().find((w) => w.userId === userId && w.nickname)?.nickname;
  }

  ownerId(): string {
    return this.owner;
  }

  async member(userId: string): Promise<MemberSnapshot | null> {
    const member = this.members.get(userId);
    return member ? { ...member, roleIds: [...member.roleIds] } : null;
  }

  cachedName(userId: string): string | undefined {
    return this.members.get(userId)?.displayName;
  }

  roleMemberCount(roleId: string): number {
    return [...this.members.values()].filter((m) => m.roleIds.includes(roleId)).length;
  }

  async update(userId: string, change: MemberUpdate, reason: string): Promise<void> {
    const member = this.members.get(userId);
    if (!member) throw new Error(`no member ${userId}`);
    this.writes.push({ userId, reason, ...change });
    member.roleIds = [...change.roleIds];
    if (change.nickname !== undefined) member.displayName = change.nickname;
  }
}
