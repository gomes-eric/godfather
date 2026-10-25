import { PermissionFlagsBits as P } from 'discord.js';

// Pure rules for the join-to-create voice rooms (PLAN.md §6.6).

/** Lowest positive number not in use: with 01 and 03 taken, the next room is 02. */
export function lowestFreeNumber(used: Iterable<number>): number {
  const taken = new Set(used);
  let n = 1;
  while (taken.has(n)) n++;
  return n;
}

/** "Abismo {n}" + 3 → "Abismo 03". */
export function roomName(template: string, n: number): string {
  return template.replaceAll('{n}', String(n).padStart(2, '0'));
}

export interface RoleOverwrite {
  id: string;
  type: 'role' | 'member';
  allow: bigint;
  deny: bigint;
}

/** Room owners can rename, set the limit and move people; moderators get no extra power here. */
export const OWNER_ALLOW = P.ViewChannel | P.Connect | P.Speak | P.ManageChannels | P.MoveMembers;

/** Overwrites for a new room: the generator's, plus owner powers for whoever created it. */
export function roomOverwrites(generator: RoleOverwrite[], ownerId: string): RoleOverwrite[] {
  return [
    ...generator.filter((o) => o.id !== ownerId),
    { id: ownerId, type: 'member', allow: OWNER_ALLOW, deny: 0n },
  ];
}

/** Who can find and join a room. Both off is the generator's own access. */
export interface RoomAccess {
  /** Nobody new can connect. */
  locked: boolean;
  /** Nobody new can even see the room in the channel list. */
  hidden: boolean;
}

/** What someone already in a locked or hidden room keeps, so a dropped connection can rejoin. */
export const OCCUPANT_ALLOW = P.ViewChannel | P.Connect;

/**
 * Overwrites for a room in the given access mode. Role overwrites are rebuilt from the
 * generator's (falling back to the room's own when the generator is gone): locking moves Connect
 * to deny, hiding does the same with ViewChannel, and @everyone gets the deny if the generator had
 * no overwrite for it. Member overwrites (owner, kicked people, earlier occupants) are kept, and
 * whoever is in the room when it closes gets their own grant to stay and come back.
 */
export function accessOverwrites(
  current: RoleOverwrite[],
  generator: RoleOverwrite[],
  everyoneId: string,
  access: RoomAccess,
  occupantIds: Iterable<string> = [],
): RoleOverwrite[] {
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

/**
 * Kicking from a room: their member overwrite denies Connect and ViewChannel, so they can't jump
 * back in and a hidden room stays hidden from them. Later lock/hide changes keep member overwrites.
 */
export function banFromRoom(current: RoleOverwrite[], userId: string): RoleOverwrite[] {
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

/** Moving ownership: owner powers leave the previous owner and go to the new one. */
export function transferOwnership(
  current: RoleOverwrite[],
  previousOwnerId: string,
  newOwnerId: string,
): RoleOverwrite[] {
  return [
    ...current.filter((o) => o.id !== previousOwnerId && o.id !== newOwnerId),
    { id: newOwnerId, type: 'member', allow: OWNER_ALLOW, deny: 0n },
  ];
}

/** Discord lets a channel be renamed twice per 10 minutes; a third waits for the window. */
export const RENAME_LIMIT = 2;
export const RENAME_WINDOW_MS = 10 * 60_000;

/**
 * When the next rename of a channel can go through, given when its recent renames happened:
 * `now` when there is budget left, otherwise the moment the oldest one leaves the window.
 */
export function nextRenameAt(history: readonly number[], now: number): number {
  const recent = history.filter((at) => now - at < RENAME_WINDOW_MS).sort((a, b) => a - b);
  if (recent.length < RENAME_LIMIT) return now;
  return recent[recent.length - RENAME_LIMIT]! + RENAME_WINDOW_MS;
}

/**
 * Serializes room creation per generator so simultaneous joins never get the same number.
 * The task reads the numbers in use, creates the room and records it.
 */
export class RoomAllocator {
  private readonly queues = new Map<string, Promise<unknown>>();

  run<T>(generatorKey: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(generatorKey) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.queues.set(generatorKey, next);
    // Drop the reference once this task is the tail, so the map doesn't grow forever.
    // The caller handles the task's own rejection through the returned promise.
    const cleanup = () => {
      if (this.queues.get(generatorKey) === next) this.queues.delete(generatorKey);
    };
    next.then(cleanup, cleanup);
    return next;
  }
}
