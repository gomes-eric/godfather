import { PermissionFlagsBits as P } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { PermissionOverwrite } from './permission-overwrite.js';
import {
  accessOverwrites,
  banFromRoom,
  lowestFreeNumber,
  nextRenameAt,
  OCCUPANT_ALLOW,
  OWNER_ALLOW,
  RoomAllocator,
  roomName,
  roomOverwrites,
  RENAME_WINDOW_MS,
  transferOwnership,
} from './voice-rooms.js';

describe('numbering', () => {
  it('uses the lowest free number', () => {
    expect(lowestFreeNumber([])).toBe(1);
    expect(lowestFreeNumber([1, 3])).toBe(2);
    expect(lowestFreeNumber([1, 2, 3])).toBe(4);
  });

  it('pads the number to two digits', () => {
    expect(roomName('Abismo {n}', 3)).toBe('Abismo 03');
    expect(roomName('Abismo {n}', 12)).toBe('Abismo 12');
  });
});

describe('RoomAllocator', () => {
  it('keeps going after a failed creation', async () => {
    const allocator = new RoomAllocator();
    await expect(
      allocator.run('g', async () => {
        throw new Error('Missing Permissions');
      }),
    ).rejects.toThrow('Missing Permissions');
    await expect(allocator.run('g', async () => 'ok')).resolves.toBe('ok');
  });

  it('does not serialize different generators against each other', async () => {
    const allocator = new RoomAllocator();
    const order: string[] = [];
    let release!: () => void;
    const slow = allocator.run('a', () =>
      new Promise<void>((r) => (release = r)).then(() => order.push('a')),
    );
    await allocator.run('b', async () => order.push('b'));
    release();
    await slow;
    expect(order).toEqual(['b', 'a']);
  });
});

describe('room overwrites', () => {
  const everyone = 'everyone';
  const generator: PermissionOverwrite[] = [
    { id: everyone, type: 'role', allow: 0n, deny: P.ViewChannel | P.Connect },
    { id: 'soldier', type: 'role', allow: P.ViewChannel | P.Connect | P.Speak, deny: 0n },
  ];

  it('copies the generator and gives the creator owner powers', () => {
    const room = roomOverwrites(generator, 'owner');
    expect(room).toContainEqual({ id: 'owner', type: 'member', allow: OWNER_ALLOW, deny: 0n });
    expect(room).toHaveLength(3);
  });

  const open = { locked: false, hidden: false };
  const room = () => roomOverwrites(generator, 'owner');

  it('lock removes Connect from every role but keeps the owner and occupants able to join', () => {
    const locked = accessOverwrites(room(), generator, everyone, { locked: true, hidden: false }, [
      'owner',
      'friend',
    ]);
    const soldier = locked.find((o) => o.id === 'soldier')!;

    expect(soldier.allow & P.Connect).toBe(0n);
    expect(soldier.deny & P.Connect).toBe(P.Connect);
    expect(soldier.allow & P.ViewChannel).toBe(P.ViewChannel);
    expect(soldier.allow & P.Speak).toBe(P.Speak);
    expect(locked.find((o) => o.id === 'owner')?.allow).toBe(OWNER_ALLOW);
    expect(locked.find((o) => o.id === 'friend')).toEqual({
      id: 'friend',
      type: 'member',
      allow: OCCUPANT_ALLOW,
      deny: 0n,
    });
  });

  it('hide removes ViewChannel from every role and adds the @everyone deny when missing', () => {
    const noEveryone = generator.filter((o) => o.id !== everyone);
    const hidden = accessOverwrites(room(), noEveryone, everyone, { locked: false, hidden: true });
    const soldier = hidden.find((o) => o.id === 'soldier')!;

    expect(soldier.allow & P.ViewChannel).toBe(0n);
    expect(soldier.allow & P.Connect).toBe(P.Connect);
    expect(hidden.find((o) => o.id === everyone)?.deny).toBe(P.ViewChannel);
  });

  it('opening again restores the generator roles and keeps member overwrites', () => {
    const closed = accessOverwrites(room(), generator, everyone, { locked: true, hidden: true }, [
      'friend',
    ]);
    const reopened = accessOverwrites(closed, generator, everyone, open, ['friend', 'newcomer']);
    expect(reopened).toEqual([
      ...room(),
      { id: 'friend', type: 'member', allow: OCCUPANT_ALLOW, deny: 0n },
    ]);
  });

  it('keeps a kicked member out across mode changes', () => {
    const kicked = banFromRoom(room(), 'troll');
    const locked = accessOverwrites(kicked, generator, everyone, { locked: true, hidden: false }, [
      'troll',
    ]);
    expect(locked.find((o) => o.id === 'troll')?.deny).toBe(OCCUPANT_ALLOW);
  });

  it('kick denies View and Connect for that member only', () => {
    const kicked = banFromRoom(roomOverwrites(generator, 'owner'), 'troll');
    expect(kicked.find((o) => o.id === 'troll')).toEqual({
      id: 'troll',
      type: 'member',
      allow: 0n,
      deny: OCCUPANT_ALLOW,
    });
    expect(kicked.find((o) => o.id === 'soldier')).toEqual(generator[1]);
  });

  it('claim moves owner powers to the new owner', () => {
    const claimed = transferOwnership(roomOverwrites(generator, 'old'), 'old', 'new');
    expect(claimed.find((o) => o.id === 'old')).toBeUndefined();
    expect(claimed.find((o) => o.id === 'new')?.allow).toBe(OWNER_ALLOW);
  });
});

describe('rename budget', () => {
  it('allows two renames per window, then waits for the oldest to age out', () => {
    expect(nextRenameAt([], 1000)).toBe(1000);
    expect(nextRenameAt([1000], 2000)).toBe(2000);
    expect(nextRenameAt([1000, 5000], 6000)).toBe(1000 + RENAME_WINDOW_MS);
    expect(nextRenameAt([1000, 5000], 1000 + RENAME_WINDOW_MS)).toBe(1000 + RENAME_WINDOW_MS);
  });

  it('ignores renames older than the window', () => {
    expect(nextRenameAt([0, 1], RENAME_WINDOW_MS + 1)).toBe(RENAME_WINDOW_MS + 1);
  });
});
