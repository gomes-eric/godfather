import { OverwriteType, type GuildChannel } from 'discord.js';
import type { PermissionOverwrite } from '../core/permission-overwrite.js';

export function readOverwrites(channel: Pick<GuildChannel, 'permissionOverwrites'>) {
  return channel.permissionOverwrites.cache.map((o): PermissionOverwrite => ({
    id: o.id,
    type: o.type === OverwriteType.Member ? 'member' : 'role',
    allow: o.allow.bitfield,
    deny: o.deny.bitfield,
  }));
}

export function toDiscordOverwrites(overwrites: readonly PermissionOverwrite[]) {
  return overwrites.map((o) => ({
    id: o.id,
    type: o.type === 'member' ? OverwriteType.Member : OverwriteType.Role,
    allow: o.allow,
    deny: o.deny,
  }));
}
