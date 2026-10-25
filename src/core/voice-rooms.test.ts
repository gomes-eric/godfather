import { PermissionFlagsBits as P } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { TempVoiceStore } from '../db/temp-voice.js';
import {
  banFromRoom,
  lockOverwrites,
  lowestFreeNumber,
  OWNER_ALLOW,
  RoomAllocator,
  roomName,
  roomOverwrites,
  transferOwnership,
  unlockOverwrites,
  type RoleOverwrite,
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
  it('gives three simultaneous joins distinct numbers, then reuses a freed one', async () => {
    const db = openDatabase(':memory:');
    const store = new TempVoiceStore(db.db);
    const allocator = new RoomAllocator();
    let nextId = 0;

    const join = (ownerId: string) =>
      allocator.run('gen-abyss', async () => {
        const n = lowestFreeNumber(store.numbersFor('gen-abyss'));
        // Simulate Discord taking a while to create the channel.
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
        const channelId = String(++nextId);
        store.insert({ channelId, generatorKey: 'gen-abyss', number: n, ownerId });
        return { channelId, n };
      });

    const rooms = await Promise.all([join('a'), join('b'), join('c')]);
    expect(rooms.map((r) => r.n).sort()).toEqual([1, 2, 3]);

    store.delete(rooms.find((r) => r.n === 2)!.channelId);
    expect((await join('d')).n).toBe(2);
    db.close();
  });

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
  const generator: RoleOverwrite[] = [
    { id: everyone, type: 'role', allow: 0n, deny: P.ViewChannel | P.Connect },
    { id: 'soldier', type: 'role', allow: P.ViewChannel | P.Connect | P.Speak, deny: 0n },
  ];

  it('copies the generator and gives the creator owner powers', () => {
    const room = roomOverwrites(generator, 'owner');
    expect(room).toContainEqual({ id: 'owner', type: 'member', allow: OWNER_ALLOW, deny: 0n });
    expect(room).toHaveLength(3);
  });

  it('lock removes Connect from every role but keeps the owner able to join', () => {
    const locked = lockOverwrites(roomOverwrites(generator, 'owner'), everyone);
    const soldier = locked.find((o) => o.id === 'soldier')!;

    expect(soldier.allow & P.Connect).toBe(0n);
    expect(soldier.deny & P.Connect).toBe(P.Connect);
    expect(soldier.allow & P.Speak).toBe(P.Speak);
    expect(locked.find((o) => o.id === 'owner')?.allow).toBe(OWNER_ALLOW);
  });

  it('unlock restores the generator roles and keeps member overwrites', () => {
    const locked = lockOverwrites(roomOverwrites(generator, 'owner'), everyone);
    const unlocked = unlockOverwrites(locked, generator);
    expect(unlocked).toEqual(roomOverwrites(generator, 'owner'));
  });

  it('kick denies Connect for that member only', () => {
    const kicked = banFromRoom(roomOverwrites(generator, 'owner'), 'troll');
    expect(kicked.find((o) => o.id === 'troll')).toEqual({
      id: 'troll',
      type: 'member',
      allow: 0n,
      deny: P.Connect,
    });
  });

  it('claim moves owner powers to the new owner', () => {
    const claimed = transferOwnership(roomOverwrites(generator, 'old'), 'old', 'new');
    expect(claimed.find((o) => o.id === 'old')).toBeUndefined();
    expect(claimed.find((o) => o.id === 'new')?.allow).toBe(OWNER_ALLOW);
  });
});
