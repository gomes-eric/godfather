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

/**
 * Locking: nobody new can connect, except members with their own overwrite (the owner, people
 * already allowed). Every role overwrite moves Connect from allow to deny, and @everyone denies it.
 */
export function lockOverwrites(current: RoleOverwrite[], everyoneId: string): RoleOverwrite[] {
  const locked = current.map((o) =>
    o.type === 'role' ? { ...o, allow: o.allow & ~P.Connect, deny: o.deny | P.Connect } : o,
  );
  return locked.some((o) => o.id === everyoneId)
    ? locked
    : [...locked, { id: everyoneId, type: 'role', allow: 0n, deny: P.Connect }];
}

/** Unlocking: role overwrites go back to the generator's; member overwrites stay. */
export function unlockOverwrites(
  current: RoleOverwrite[],
  generator: RoleOverwrite[],
): RoleOverwrite[] {
  return [
    ...generator.filter((o) => o.type === 'role'),
    ...current.filter((o) => o.type === 'member'),
  ];
}

/** Kicking from a room: their member overwrite denies Connect so they can't jump back in. */
export function banFromRoom(current: RoleOverwrite[], userId: string): RoleOverwrite[] {
  const existing = current.find((o) => o.id === userId);
  const others = current.filter((o) => o.id !== userId);
  return [
    ...others,
    {
      id: userId,
      type: 'member',
      allow: (existing?.allow ?? 0n) & ~P.Connect,
      deny: (existing?.deny ?? 0n) | P.Connect,
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
