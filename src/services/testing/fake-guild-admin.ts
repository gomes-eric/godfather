import type {
  ChannelFields,
  ChannelView,
  GuildAdminPort,
  MemberView,
  MessageView,
  NewChannelSpec,
  OutgoingMessage,
  RoleFields,
  RoleView,
  UserView,
} from '../guild-admin-port.js';

let nextId = 2_000_000_000_000_000n;
const newId = () => String(nextId++);

const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const PLAIN_MAX = 2000;
const EMBED_DESCRIPTION_MAX = 4096;

type FakeRole = Omit<RoleView, 'memberCount'> & Omit<RoleFields, 'name'>;
type FakeChannel = ChannelView & { topic: string | null; userLimit: number };

export class FakeGuildAdmin implements GuildAdminPort {
  owner = newId();
  botPosition: number | null = 10;
  now = () => new Date();

  readonly memberList = new Map<string, MemberView>();
  readonly users = new Map<string, UserView>();
  readonly bans = new Map<
    string,
    { user: UserView; reason: string; deleteMessageSeconds: number }
  >();
  readonly timeouts = new Map<string, number | null>();
  roleList: FakeRole[] = [];
  channelList: FakeChannel[] = [];
  readonly messages = new Map<string, MessageView[]>();
  readonly sent: { channelId: string; message: OutgoingMessage }[] = [];

  seedMember(fields: Partial<MemberView> & Pick<MemberView, 'displayName'>): MemberView {
    const member: MemberView = {
      id: newId(),
      username: fields.displayName.toLowerCase(),
      globalName: null,
      nickname: null,
      bot: false,
      roleIds: [],
      kickable: true,
      bannable: true,
      moderatable: true,
      ...fields,
    };
    this.memberList.set(member.id, member);
    this.users.set(member.id, { id: member.id, username: member.username, bot: member.bot });
    return member;
  }

  seedUser(username: string): UserView {
    const user = { id: newId(), username, bot: false };
    this.users.set(user.id, user);
    return user;
  }

  seedRole(fields: Partial<FakeRole> & Pick<FakeRole, 'name'>): string {
    const role: FakeRole = { id: newId(), position: 1, managed: false, ...fields };
    this.roleList.push(role);
    return role.id;
  }

  seedChannel(fields: Partial<FakeChannel> & Pick<FakeChannel, 'name' | 'kind'>): FakeChannel {
    const textLike = ['text', 'announcement', 'forum'].includes(fields.kind);
    const channel: FakeChannel = {
      id: newId(),
      parentId: null,
      hasTopic: textLike,
      messageable:
        fields.kind === 'text' || fields.kind === 'announcement' || fields.kind === 'voice',
      topic: null,
      userLimit: 0,
      ...fields,
    };
    this.channelList.push(channel);
    return channel;
  }

  seedMessage(channelId: string, authorId: string, ageMs = 0, content = 'oi'): string {
    const id = newId();
    const list = this.messages.get(channelId) ?? [];
    list.push({
      id,
      authorId,
      authorName: this.memberList.get(authorId)?.displayName ?? authorId,
      content,
      createdAt: new Date(this.now().getTime() - ageMs),
    });
    this.messages.set(channelId, list);
    return id;
  }

  ownerId(): string {
    return this.owner;
  }

  botTopRolePosition(): number | null {
    return this.botPosition;
  }

  members(): MemberView[] {
    return [...this.memberList.values()];
  }

  async fetchMember(userId: string): Promise<MemberView | null> {
    return this.memberList.get(userId) ?? null;
  }

  async fetchUser(userId: string): Promise<UserView | null> {
    return this.users.get(userId) ?? null;
  }

  private member(
    userId: string,
    allowed: keyof Pick<MemberView, 'kickable' | 'bannable' | 'moderatable'>,
  ) {
    const member = this.memberList.get(userId);
    if (!member) throw new Error('Unknown Member');
    if (!member[allowed]) throw new Error('Missing Permissions');
    return member;
  }

  async kick(userId: string): Promise<void> {
    this.member(userId, 'kickable');
    this.memberList.delete(userId);
  }

  async ban(userId: string, reason: string, deleteMessageSeconds: number): Promise<void> {
    if (this.memberList.has(userId)) this.member(userId, 'bannable');
    const user = this.users.get(userId);
    if (!user) throw new Error('Unknown User');
    this.bans.set(userId, { user, reason, deleteMessageSeconds });
    this.memberList.delete(userId);
  }

  async fetchBan(userId: string): Promise<UserView | null> {
    return this.bans.get(userId)?.user ?? null;
  }

  async unban(userId: string): Promise<void> {
    if (!this.bans.delete(userId)) throw new Error('Unknown Ban');
  }

  async timeout(userId: string, durationMs: number | null): Promise<void> {
    this.member(userId, 'moderatable');
    this.timeouts.set(userId, durationMs);
  }

  roles(): RoleView[] {
    return this.roleList.map((role) => ({
      ...role,
      memberCount: this.members().filter((m) => m.roleIds.includes(role.id)).length,
    }));
  }

  private manageableRole(roleId: string): FakeRole {
    const role = this.roleList.find((r) => r.id === roleId);
    if (!role) throw new Error('Unknown Role');
    if (role.managed || (this.botPosition !== null && role.position >= this.botPosition)) {
      throw new Error('Missing Permissions');
    }
    return role;
  }

  async createRole(fields: RoleFields & { name: string }): Promise<RoleView> {
    // Discord puts new roles right above @everyone.
    for (const role of this.roleList) role.position++;
    if (this.botPosition !== null) this.botPosition++;
    const id = this.seedRole({ ...fields, position: 1 });
    return this.roles().find((r) => r.id === id)!;
  }

  async editRole(roleId: string, fields: RoleFields): Promise<void> {
    Object.assign(this.manageableRole(roleId), fields);
  }

  async deleteRole(roleId: string): Promise<void> {
    this.manageableRole(roleId);
    this.roleList = this.roleList.filter((r) => r.id !== roleId);
  }

  async addRole(userId: string, roleId: string): Promise<void> {
    this.manageableRole(roleId);
    const member = this.memberList.get(userId);
    if (!member) throw new Error('Unknown Member');
    if (!member.roleIds.includes(roleId)) member.roleIds.push(roleId);
  }

  async removeRole(userId: string, roleId: string): Promise<void> {
    this.manageableRole(roleId);
    const member = this.memberList.get(userId);
    if (!member) throw new Error('Unknown Member');
    member.roleIds = member.roleIds.filter((id) => id !== roleId);
  }

  channels(): ChannelView[] {
    return this.channelList.map((c) => ({ ...c }));
  }

  async fetchChannel(channelId: string): Promise<ChannelView | null> {
    return this.channels().find((c) => c.id === channelId) ?? null;
  }

  private channel(channelId: string): FakeChannel {
    const channel = this.channelList.find((c) => c.id === channelId);
    if (!channel) throw new Error('Unknown Channel');
    return channel;
  }

  async createChannel(spec: NewChannelSpec): Promise<ChannelView> {
    if (spec.parentId && this.channel(spec.parentId).kind !== 'category') {
      throw new Error('Invalid Form Body: parent_id');
    }
    if (spec.topic !== undefined && spec.kind !== 'text') throw new Error('Invalid Form Body');
    if (spec.userLimit !== undefined && spec.kind !== 'voice') throw new Error('Invalid Form Body');
    return this.seedChannel({
      name: spec.name,
      kind: spec.kind,
      parentId: spec.parentId ?? null,
      topic: spec.topic ?? null,
      userLimit: spec.userLimit ?? 0,
    });
  }

  async editChannel(channelId: string, fields: ChannelFields): Promise<void> {
    const channel = this.channel(channelId);
    if (fields.topic !== undefined && !channel.hasTopic) throw new Error('Invalid Form Body');
    if (fields.userLimit !== undefined && channel.kind !== 'voice') {
      throw new Error('Invalid Form Body');
    }
    Object.assign(channel, fields);
  }

  async deleteChannel(channelId: string): Promise<void> {
    this.channel(channelId);
    this.channelList = this.channelList.filter((c) => c.id !== channelId);
  }

  private messageable(channelId: string): FakeChannel {
    const channel = this.channel(channelId);
    if (!channel.messageable) throw new Error('Cannot send messages in a non-text channel');
    return channel;
  }

  async newestMessages(channelId: string, limit: number): Promise<MessageView[]> {
    this.messageable(channelId);
    return [...(this.messages.get(channelId) ?? [])].reverse().slice(0, limit);
  }

  async bulkDelete(channelId: string, messageIds: string[]): Promise<number> {
    this.messageable(channelId);
    const list = this.messages.get(channelId) ?? [];
    const cutoff = this.now().getTime() - BULK_DELETE_MAX_AGE_MS;
    const targets = list.filter((m) => messageIds.includes(m.id));
    if (targets.some((m) => m.createdAt.getTime() <= cutoff)) {
      throw new Error('You can only bulk delete messages that are under 14 days old.');
    }
    this.messages.set(
      channelId,
      list.filter((m) => !messageIds.includes(m.id)),
    );
    return targets.length;
  }

  async send(channelId: string, message: OutgoingMessage): Promise<void> {
    this.messageable(channelId);
    if ('content' in message && message.content.length > PLAIN_MAX) {
      throw new Error('Invalid Form Body: content must be 2000 or fewer in length');
    }
    if ('embed' in message && message.embed.description.length > EMBED_DESCRIPTION_MAX) {
      throw new Error('Invalid Form Body: description must be 4096 or fewer in length');
    }
    this.sent.push({ channelId, message });
  }
}
