import type { ChannelSnapshot, GuildSnapshot, RoleSnapshot } from '../model.js';
import type { ChannelPosition, ChannelSpec, GuildPort, PanelMessage, RoleSpec } from '../port.js';

let nextId = 1_000_000_000_000_000n;
const newId = () => String(nextId++);

/**
 * In-memory guild that behaves like Discord for everything /setup does: role positions with a
 * bot role that can't manage roles above it, channel positions, overwrites, forum tags,
 * the Community feature and panel messages.
 */
export class FakeGuild implements GuildPort {
  readonly everyoneRoleId = newId();
  readonly botRoleId = newId();
  roles: RoleSnapshot[] = [];
  channels: ChannelSnapshot[] = [];
  messages = new Map<string, { channelId: string; panel: PanelMessage }>();
  community = false;
  rulesChannelId: string | null = null;
  publicUpdatesChannelId: string | null = null;
  afkChannelId: string | null = null;
  afkTimeout = 300;
  failCommunity = false;
  calls: string[] = [];

  constructor() {
    this.roles.push(
      this.role({ id: this.everyoneRoleId, name: '@everyone', position: 0 }),
      this.role({ id: this.botRoleId, name: 'Padrinho', position: 1, integration: true }),
    );
  }

  private role(fields: Partial<RoleSnapshot> & Pick<RoleSnapshot, 'id' | 'name' | 'position'>) {
    return {
      color: 0,
      hoist: false,
      mentionable: false,
      permissions: 0n,
      integration: false,
      ...fields,
    };
  }

  /** Adds a role at the top of the list (above the bot), like one created by a human. */
  addRoleAboveBot(name: string): string {
    const id = newId();
    this.roles.push(this.role({ id, name, position: this.roles.length }));
    return id;
  }

  addChannel(fields: Partial<ChannelSnapshot> & Pick<ChannelSnapshot, 'name' | 'kind'>): string {
    const id = newId();
    this.channels.push({
      id,
      parentId: null,
      position: this.channels.length,
      topic: null,
      userLimit: 0,
      overwrites: [],
      tags: [],
      requireTag: false,
      ...fields,
    });
    return id;
  }

  get botRolePosition(): number {
    return this.roles.find((r) => r.id === this.botRoleId)!.position;
  }

  async snapshot(messages: { channelId: string; messageId: string }[]): Promise<GuildSnapshot> {
    return structuredClone({
      everyoneRoleId: this.everyoneRoleId,
      botRolePosition: this.botRolePosition,
      roles: this.roles,
      channels: this.channels,
      community: this.community,
      rulesChannelId: this.rulesChannelId,
      publicUpdatesChannelId: this.publicUpdatesChannelId,
      afkChannelId: this.afkChannelId,
      afkTimeout: this.afkTimeout,
      existingMessageIds: new Set(
        messages
          .filter((m) => this.messages.get(m.messageId)?.channelId === m.channelId)
          .map((m) => m.messageId),
      ),
    });
  }

  private assertManageable(id: string) {
    const role = this.roles.find((r) => r.id === id);
    if (!role) throw new Error(`Unknown Role ${id}`);
    if (role.position >= this.botRolePosition) throw new Error('Missing Permissions');
    return role;
  }

  async createRole(spec: RoleSpec): Promise<string> {
    this.calls.push(`createRole:${spec.name}`);
    const id = newId();
    // Discord puts new roles right above @everyone.
    for (const role of this.roles) if (role.position >= 1) role.position++;
    this.roles.push(this.role({ id, position: 1, ...spec }));
    return id;
  }

  async editRole(id: string, spec: RoleSpec): Promise<void> {
    this.calls.push(`editRole:${spec.name}`);
    Object.assign(this.assertManageable(id), spec);
  }

  async deleteRole(id: string): Promise<void> {
    this.assertManageable(id);
    this.roles = this.roles.filter((r) => r.id !== id);
  }

  async setRolePositions(idsTopToBottom: string[]): Promise<void> {
    this.calls.push('setRolePositions');
    idsTopToBottom.forEach((id) => this.assertManageable(id));
    const others = this.roles
      .filter((r) => r.id !== this.everyoneRoleId && !idsTopToBottom.includes(r.id))
      .sort((a, b) => a.position - b.position);
    const bottomUp = [...idsTopToBottom]
      .reverse()
      .map((id) => this.roles.find((r) => r.id === id)!);
    [...bottomUp, ...others].forEach((role, i) => (role.position = i + 1));
  }

  async createChannel(spec: ChannelSpec): Promise<string> {
    this.calls.push(`createChannel:${spec.name}`);
    if ((spec.kind === 'announcement' || spec.kind === 'forum') && !this.community) {
      throw new Error('Community is required');
    }
    return this.addChannel(this.toSnapshotFields(spec));
  }

  async editChannel(id: string, spec: ChannelSpec): Promise<void> {
    this.calls.push(`editChannel:${spec.name}`);
    const channel = this.channels.find((c) => c.id === id);
    if (!channel) throw new Error(`Unknown Channel ${id}`);
    Object.assign(channel, this.toSnapshotFields(spec));
  }

  private toSnapshotFields(spec: ChannelSpec) {
    return {
      name: spec.name,
      kind: spec.kind,
      parentId: spec.parentId,
      topic: spec.topic,
      userLimit: spec.userLimit,
      overwrites: spec.overwrites.map((o) => ({ ...o })),
      tags: spec.tags.map((t) => ({ ...t, id: t.id ?? newId() })),
      requireTag: spec.requireTag,
    };
  }

  async deleteChannel(id: string): Promise<void> {
    this.channels = this.channels.filter((c) => c.id !== id);
  }

  async setChannelPositions(positions: ChannelPosition[]): Promise<void> {
    this.calls.push('setChannelPositions');
    for (const { id, parentId, position } of positions) {
      const channel = this.channels.find((c) => c.id === id)!;
      channel.parentId = parentId;
      channel.position = position;
    }
  }

  async enableCommunity(rulesChannelId: string, updatesChannelId: string): Promise<void> {
    if (this.failCommunity) throw new Error('Missing Access');
    this.community = true;
    await this.setCommunityChannels(rulesChannelId, updatesChannelId);
  }

  async setCommunityChannels(rulesChannelId: string, updatesChannelId: string): Promise<void> {
    this.rulesChannelId = rulesChannelId;
    this.publicUpdatesChannelId = updatesChannelId;
  }

  async setAfk(channelId: string, timeoutSeconds: number): Promise<void> {
    this.afkChannelId = channelId;
    this.afkTimeout = timeoutSeconds;
  }

  async upsertPanel(
    channelId: string,
    messageId: string | null,
    panel: PanelMessage,
  ): Promise<string> {
    this.calls.push('upsertPanel');
    if (messageId && this.messages.get(messageId)?.channelId === channelId) {
      this.messages.set(messageId, { channelId, panel });
      return messageId;
    }
    const id = newId();
    this.messages.set(id, { channelId, panel });
    return id;
  }
}
