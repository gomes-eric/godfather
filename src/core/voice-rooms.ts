import { PermissionFlagsBits as P } from 'discord.js';
import type { PermissionOverwrite } from './permission-overwrite.js';

export function lowestFreeNumber(used: Iterable<number>): number {
  const taken = new Set(used);
  let n = 1;
  while (taken.has(n)) n++;
  return n;
}

export function roomName(template: string, n: number): string {
  return template.replaceAll('{n}', String(n).padStart(2, '0'));
}

export const OWNER_ALLOW = P.ViewChannel | P.Connect | P.Speak | P.ManageChannels | P.MoveMembers;

export function roomOverwrites(
  generator: PermissionOverwrite[],
  ownerId: string,
): PermissionOverwrite[] {
  return [
    ...generator.filter((o) => o.id !== ownerId),
    { id: ownerId, type: 'member', allow: OWNER_ALLOW, deny: 0n },
  ];
}

export interface RoomAccess {
  locked: boolean;
  hidden: boolean;
}

export const OCCUPANT_ALLOW = P.ViewChannel | P.Connect;

export function accessOverwrites(
  current: PermissionOverwrite[],
  generator: PermissionOverwrite[],
  everyoneId: string,
  access: RoomAccess,
  occupantIds: Iterable<string> = [],
): PermissionOverwrite[] {
  const closed = (access.locked ? P.Connect : 0n) | (access.hidden ? P.ViewChannel : 0n);
  const source = generator.length > 0 ? generator : current;
  const roles = source
    .filter((o) => o.type === 'role')
    .map((o) => ({ ...o, allow: o.allow & ~closed, deny: o.deny | closed }));
  if (closed !== 0n && !roles.some((o) => o.id === everyoneId)) {
    roles.push({ id: everyoneId, type: 'role', allow: 0n, deny: closed });
  }

  const members = current.filter((o) => o.type === 'member');
  if (closed !== 0n) {
    for (const id of occupantIds) {
      if (members.some((o) => o.id === id)) continue;
      members.push({ id, type: 'member', allow: OCCUPANT_ALLOW, deny: 0n });
    }
  }
  return [...roles, ...members];
}

export function banFromRoom(current: PermissionOverwrite[], userId: string): PermissionOverwrite[] {
  const existing = current.find((o) => o.id === userId);
  const others = current.filter((o) => o.id !== userId);
  return [
    ...others,
    {
      id: userId,
      type: 'member',
      allow: (existing?.allow ?? 0n) & ~OCCUPANT_ALLOW,
      deny: (existing?.deny ?? 0n) | OCCUPANT_ALLOW,
    },
  ];
}

export function transferOwnership(
  current: PermissionOverwrite[],
  previousOwnerId: string,
  newOwnerId: string,
): PermissionOverwrite[] {
  return [
    ...current.filter((o) => o.id !== previousOwnerId && o.id !== newOwnerId),
    { id: newOwnerId, type: 'member', allow: OWNER_ALLOW, deny: 0n },
  ];
}

/** Discord lets a channel be renamed twice per 10 minutes; a third waits for the window. */
export const RENAME_LIMIT = 2;
export const RENAME_WINDOW_MS = 10 * 60_000;

export function nextRenameAt(history: readonly number[], now: number): number {
  const recent = history.filter((at) => now - at < RENAME_WINDOW_MS).sort((a, b) => a - b);
  if (recent.length < RENAME_LIMIT) return now;
  return recent[recent.length - RENAME_LIMIT]! + RENAME_WINDOW_MS;
}

export class RoomAllocator {
  private readonly queues = new Map<string, Promise<unknown>>();

  run<T>(generatorKey: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(generatorKey) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.queues.set(generatorKey, next);
    const cleanup = () => {
      if (this.queues.get(generatorKey) === next) this.queues.delete(generatorKey);
    };
    next.then(cleanup, cleanup);
    return next;
  }
}
