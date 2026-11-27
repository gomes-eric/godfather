import type { PermissionOverwrite } from '../../core/permission-overwrite.js';
import type {
  RenameResult,
  RoomChannelSpec,
  RoomMember,
  RoomPanelView,
  VoiceChannelInfo,
  VoiceRoomPort,
} from '../voice-port.js';

let nextId = 2_000_000_000_000_000n;
const newId = () => String(nextId++);

/** Lets other pending work run, the way a round trip to Discord would. */
const roundTrip = () => new Promise<void>((resolve) => setImmediate(resolve));

const copy = (overwrites: readonly PermissionOverwrite[]) => overwrites.map((o) => ({ ...o }));

export class FakeVoicePort implements VoiceRoomPort {
  readonly everyoneRoleId = newId();
  readonly channels = new Map<string, VoiceChannelInfo>();
  readonly people = new Map<string, RoomMember>();
  /** The voice channel each connected user is in. */
  readonly connected = new Map<string, string>();
  readonly panels = new Map<string, { channelId: string; view: RoomPanelView }>();
  /** Users who leave voice before the bot can move them. */
  readonly unmovable = new Set<string>();
  failCreates = 0;
  failDeletes = 0;
  holdRenames = false;

  addChannel(fields: Partial<VoiceChannelInfo> & Pick<VoiceChannelInfo, 'name'>): string {
    const id = newId();
    this.channels.set(id, {
      id,
      parentId: null,
      position: 0,
      userLimit: 0,
      overwrites: [],
      ...fields,
    });
    return id;
  }

  addMember(displayName: string, options: { bot?: boolean } = {}): string {
    const id = newId();
    this.people.set(id, {
      id,
      displayName,
      username: displayName.toLowerCase(),
      bot: options.bot ?? false,
    });
    return id;
  }

  /** Moves the user as Discord would on their own action; returns the channel they left. */
  connect(userId: string, channelId: string | null): string | null {
    const from = this.connected.get(userId) ?? null;
    if (channelId) this.connected.set(userId, channelId);
    else this.connected.delete(userId);
    return from;
  }

  /** Channel names in a category, top to bottom. */
  order(parentId: string): string[] {
    return [...this.channels.values()]
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.position - b.position)
      .map((c) => c.name);
  }

  panelIn(channelId: string): RoomPanelView | undefined {
    return [...this.panels.values()].filter((p) => p.channelId === channelId).at(-1)?.view;
  }

  private channel(id: string): VoiceChannelInfo {
    const channel = this.channels.get(id);
    if (!channel) throw new Error(`Unknown Channel ${id}`);
    return channel;
  }

  voiceChannel(id: string): VoiceChannelInfo | undefined {
    const channel = this.channels.get(id);
    return channel && { ...channel, overwrites: copy(channel.overwrites) };
  }

  members(channelId: string): RoomMember[] {
    return [...this.connected]
      .filter(([, inChannel]) => inChannel === channelId)
      .map(([userId]) => this.people.get(userId)!);
  }

  voiceChannelOf(userId: string): string | null {
    return this.connected.get(userId) ?? null;
  }

  async createChannel(spec: RoomChannelSpec): Promise<string> {
    await roundTrip();
    if (this.failCreates > 0) {
      this.failCreates--;
      throw new Error('Missing Permissions');
    }
    for (const sibling of this.channels.values()) {
      if (sibling.parentId === spec.parentId && sibling.position >= spec.position) {
        sibling.position++;
      }
    }
    return this.addChannel({
      name: spec.name,
      parentId: spec.parentId,
      position: spec.position,
      userLimit: spec.userLimit,
      overwrites: copy(spec.overwrites),
    });
  }

  async deleteChannel(id: string): Promise<void> {
    await roundTrip();
    if (this.failDeletes > 0) {
      this.failDeletes--;
      throw new Error('Missing Permissions');
    }
    this.channels.delete(id);
    for (const [userId, channelId] of this.connected) {
      if (channelId === id) this.connected.delete(userId);
    }
    for (const [messageId, panel] of this.panels) {
      if (panel.channelId === id) this.panels.delete(messageId);
    }
  }

  async moveMember(userId: string, channelId: string | null): Promise<void> {
    await roundTrip();
    if (!this.connected.has(userId) || this.unmovable.has(userId)) {
      throw new Error('Target user is not connected to voice');
    }
    if (channelId) this.channel(channelId);
    this.connect(userId, channelId);
  }

  async setOverwrites(channelId: string, overwrites: PermissionOverwrite[]): Promise<void> {
    this.channel(channelId).overwrites = copy(overwrites);
  }

  async setUserLimit(channelId: string, limit: number): Promise<void> {
    this.channel(channelId).userLimit = limit;
  }

  async setName(channelId: string, name: string): Promise<RenameResult> {
    const channel = this.channel(channelId);
    if (this.holdRenames) return 'queued';
    channel.name = name;
    return 'done';
  }

  async postPanel(channelId: string, view: RoomPanelView): Promise<string> {
    this.channel(channelId);
    const id = newId();
    this.panels.set(id, { channelId, view: { ...view } });
    return id;
  }

  async editPanel(channelId: string, messageId: string, view: RoomPanelView): Promise<void> {
    const panel = this.panels.get(messageId);
    if (panel?.channelId !== channelId) throw new Error('Unknown Message');
    panel.view = { ...view };
  }
}
