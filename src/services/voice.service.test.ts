import { fileURLToPath } from 'node:url';
import { PermissionFlagsBits as P } from 'discord.js';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadServerConfig } from '../config/loader.js';
import { createActionRunner, rejected } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import type { AuditEntry } from '../core/audit.js';
import type { PermissionOverwrite } from '../core/permission-overwrite.js';
import type { Tier } from '../core/tiers.js';
import { OCCUPANT_ALLOW, OWNER_ALLOW, RENAME_WINDOW_MS } from '../core/voice-rooms.js';
import { openDatabase, type DatabaseHandle } from '../db/client.js';
import { ManagedObjectStore } from '../db/managed-objects.js';
import { TempVoiceStore } from '../db/temp-voice.js';
import { ptBR } from '../i18n/pt-BR.js';
import { FakeVoicePort } from './testing/fake-voice-port.js';
import { VoiceService } from './voice.service.js';

const t = ptBR.voice;
const repoConfig = loadServerConfig(fileURLToPath(new URL('../../server.yaml', import.meta.url)));
const logger = pino({ level: 'silent' });
const CATEGORY = 'abyss-rooms';
const SOLDIER_ROLE = 'soldier-role';
const MINUTE = 60_000;

const handles: DatabaseHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

const actor = (userId: string, tier: Tier = 'soldier'): Actor => ({
  userId,
  tier,
  source: 'slash',
});

function setup(options: { maxCreationsPerMinute?: number } = {}) {
  const handle = openDatabase(':memory:');
  handles.push(handle);
  const rooms = new TempVoiceStore(handle.db);
  const managed = new ManagedObjectStore(handle.db);
  const config = structuredClone(repoConfig);
  config.settings.voiceRooms.maxCreationsPerMinute = options.maxCreationsPerMinute ?? 30;

  const port = new FakeVoicePort();
  const generatorOverwrites: PermissionOverwrite[] = [
    { id: port.everyoneRoleId, type: 'role', allow: 0n, deny: P.ViewChannel | P.Connect },
    { id: SOLDIER_ROLE, type: 'role', allow: P.ViewChannel | P.Connect | P.Speak, deny: 0n },
  ];
  const generator = port.addChannel({
    name: '➕ Criar',
    parentId: CATEGORY,
    overwrites: generatorOverwrites,
  });
  managed.set('channel', 'gen-abyss', generator);

  const audits: AuditEntry[] = [];
  const clock = { now: Date.UTC(2026, 10, 27, 21) };
  const voice = new VoiceService({
    port,
    config: { get: () => config },
    managed,
    rooms,
    runAction: createActionRunner({
      record: async (entry) => {
        audits.push(entry);
        return { ...entry, id: audits.length, at: new Date(clock.now) };
      },
    }),
    logger,
    now: () => clock.now,
  });

  const join = async (userId: string, channelId: string) => {
    const from = port.connect(userId, channelId);
    await voice.memberMoved(userId, from, channelId);
  };
  const leave = async (userId: string) => {
    const from = port.connect(userId, null);
    await voice.memberMoved(userId, from, null);
  };
  /** Opens a room owned by the first user and puts the others in it. */
  const roomWith = async (owner: string, ...guests: string[]) => {
    await join(owner, generator);
    const room = voice.roomOf(owner)!;
    for (const guest of guests) await join(guest, room);
    return room;
  };
  const roles = (channelId: string) =>
    port.voiceChannel(channelId)!.overwrites.filter((o) => o.type === 'role');
  const overwriteFor = (channelId: string, id: string) =>
    port.voiceChannel(channelId)!.overwrites.find((o) => o.id === id);
  const audited = () =>
    audits.map((a) => ({ action: a.action, by: a.actor.userId, result: a.result }));

  return {
    port,
    voice,
    rooms,
    config,
    clock,
    generator,
    generatorOverwrites,
    join,
    leave,
    roomWith,
    roles,
    overwriteFor,
    audited,
  };
}

describe('VoiceService rooms', () => {
  it('gives simultaneous joins distinct numbers, each room right after the one before', async () => {
    const s = setup();
    const people = ['Padrinho', 'Bia', 'Caio'].map((name) => s.port.addMember(name));

    await Promise.all(people.map((id) => s.join(id, s.generator)));

    expect(s.port.order(CATEGORY)).toEqual(['➕ Criar', 'Abismo 01', 'Abismo 02', 'Abismo 03']);
    const rooms = people.map((id) => s.voice.describe(s.voice.roomOf(id))!);
    expect(new Set(rooms.map((r) => r.id)).size).toBe(3);
    rooms.forEach((room, i) => {
      expect(room.ownerId).toBe(people[i]);
      expect(room.occupants.map((o) => o.id)).toEqual([people[i]]);
      expect(room.userLimit).toBe(20);
      expect(s.port.panelIn(room.id)).toMatchObject({ ownerId: people[i], locked: false });
      expect(s.overwriteFor(room.id, people[i]!)?.allow).toBe(OWNER_ALLOW);
    });
  });

  it('reuses the lowest free number and places it after the room before it', async () => {
    const s = setup();
    const [a, b, c, d] = ['Padrinho', 'Bia', 'Caio', 'Duda'].map((name) => s.port.addMember(name));
    for (const id of [a!, b!, c!]) await s.join(id, s.generator);

    await s.leave(b!);
    expect(s.port.order(CATEGORY)).toEqual(['➕ Criar', 'Abismo 01', 'Abismo 03']);

    await s.join(d!, s.generator);
    expect(s.port.order(CATEGORY)).toEqual(['➕ Criar', 'Abismo 01', 'Abismo 02', 'Abismo 03']);
    expect(s.voice.describe(s.voice.roomOf(d!))?.name).toBe('Abismo 02');
  });

  it('deletes a room when the last person leaves, not before', async () => {
    const s = setup();
    const [owner, guest] = ['Padrinho', 'Bia'].map((name) => s.port.addMember(name));
    const room = await s.roomWith(owner!, guest!);

    await s.leave(owner!);
    expect(s.voice.describe(room)?.occupants.map((o) => o.id)).toEqual([guest]);

    await s.join(guest!, s.generator);
    expect(s.port.voiceChannel(room)).toBeUndefined();
    expect(s.rooms.get(room)).toBeUndefined();
    expect(s.voice.describe(s.voice.roomOf(guest!))?.name).toBe('Abismo 01');
  });

  it('opens no room for a bot', async () => {
    const s = setup();
    const bot = s.port.addMember('Jockie Music', { bot: true });
    await s.join(bot, s.generator);
    expect(s.port.order(CATEGORY)).toEqual(['➕ Criar']);
  });

  it('removes the new channel when the room cannot be saved, and keeps serving joins', async () => {
    const s = setup();
    const [a, b] = ['Padrinho', 'Bia'].map((name) => s.port.addMember(name));
    vi.spyOn(s.rooms, 'insert').mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY');
    });

    await s.join(a!, s.generator);
    expect(s.port.order(CATEGORY)).toEqual(['➕ Criar']);
    expect(s.port.voiceChannelOf(a!)).toBe(s.generator);

    await s.join(b!, s.generator);
    expect(s.port.order(CATEGORY)).toEqual(['➕ Criar', 'Abismo 01']);
    expect(s.voice.roomOf(b!)).not.toBeNull();
  });

  it('removes the room when its owner cannot be moved into it', async () => {
    const s = setup();
    const owner = s.port.addMember('Padrinho');
    s.port.unmovable.add(owner);

    await s.join(owner, s.generator);
    expect(s.port.order(CATEGORY)).toEqual(['➕ Criar']);
    expect(s.rooms.all()).toEqual([]);
    expect(s.port.panels.size).toBe(0);
  });

  it('keeps an empty room whose channel could not be deleted, and retries on the next sweep', async () => {
    const s = setup();
    const owner = s.port.addMember('Padrinho');
    const room = await s.roomWith(owner);
    s.port.failDeletes = 1;

    await s.leave(owner);
    expect(s.voice.describe(room)?.occupants).toEqual([]);

    expect(await s.voice.sweep()).toEqual({ removed: 1, created: 0 });
    expect(s.port.voiceChannel(room)).toBeUndefined();
  });
});

describe('VoiceService sweep', () => {
  it('cleans up after downtime and opens rooms for people already waiting', async () => {
    const s = setup();
    const [a, b, c, e] = ['Padrinho', 'Bia', 'Caio', 'Edu'].map((name) => s.port.addMember(name));
    const emptied = await s.roomWith(a!);
    const occupied = await s.roomWith(b!);
    s.rooms.insert({
      channelId: 'deleted-by-hand',
      generatorKey: 'gen-abyss',
      number: 3,
      ownerId: a!,
    });
    const unpaneled = s.port.addChannel({ name: 'Abismo 04', parentId: CATEGORY, position: 9 });
    s.rooms.insert({ channelId: unpaneled, generatorKey: 'gen-abyss', number: 4, ownerId: e! });
    s.port.connect(e!, unpaneled);
    s.port.connect(a!, null);
    s.port.connect(c!, s.generator);

    expect(await s.voice.sweep()).toEqual({ removed: 2, created: 1 });

    expect(s.port.voiceChannel(emptied)).toBeUndefined();
    expect(s.voice.describe(occupied)?.ownerId).toBe(b);
    expect(s.rooms.get('deleted-by-hand')).toBeUndefined();
    expect(s.port.panelIn(unpaneled)).toMatchObject({ ownerId: e });
    expect(s.rooms.get(unpaneled)?.panelMessageId).not.toBeNull();
    expect(s.voice.describe(s.voice.roomOf(c!))?.name).toBe('Abismo 01');
  });

  it('counts neither throttled nor failed creations', async () => {
    const s = setup({ maxCreationsPerMinute: 2 });
    const people = ['Padrinho', 'Bia', 'Caio'].map((name) => s.port.addMember(name));
    for (const id of people) s.port.connect(id, s.generator);
    s.port.connect(s.port.addMember('Jockie Music', { bot: true }), s.generator);
    s.port.failCreates = 1;

    expect(await s.voice.sweep()).toEqual({ removed: 0, created: 1 });
    expect(s.port.order(CATEGORY)).toEqual(['➕ Criar', 'Abismo 01']);

    s.clock.now += MINUTE;
    expect(await s.voice.sweep()).toEqual({ removed: 0, created: 2 });
    expect(s.port.order(CATEGORY)).toEqual(['➕ Criar', 'Abismo 01', 'Abismo 02', 'Abismo 03']);
  });
});

describe('VoiceService room commands', () => {
  it('locks, hides and opens again, keeping the people inside and the panel in step', async () => {
    const s = setup();
    const [owner, guest] = ['Padrinho', 'Bia'].map((name) => s.port.addMember(name));
    const room = await s.roomWith(owner!, guest!);
    const panelId = s.rooms.get(room)!.panelMessageId;
    const as = actor(owner!);

    expect(await s.voice.manage(as, room, { type: 'lock' })).toEqual({
      status: 'ok',
      value: t.locked,
    });
    expect(s.voice.describe(room)).toMatchObject({ locked: true, hidden: false });
    expect(s.overwriteFor(room, SOLDIER_ROLE)?.deny).toBe(P.Connect);
    expect(s.overwriteFor(room, guest!)).toMatchObject({ allow: OCCUPANT_ALLOW, deny: 0n });
    expect(s.overwriteFor(room, owner!)?.allow).toBe(OWNER_ALLOW);

    await s.voice.manage(as, room, { type: 'hide' });
    expect(s.voice.describe(room)).toMatchObject({ locked: true, hidden: true });
    expect(s.overwriteFor(room, SOLDIER_ROLE)?.deny).toBe(P.Connect | P.ViewChannel);
    expect(s.port.panelIn(room)).toMatchObject({ locked: true, hidden: true });

    await s.voice.manage(as, room, { type: 'unlock' });
    await s.voice.manage(as, room, { type: 'unhide' });
    expect(s.voice.describe(room)).toMatchObject({ locked: false, hidden: false });
    expect(s.roles(room)).toEqual(s.generatorOverwrites);
    expect(s.rooms.get(room)!.panelMessageId).toBe(panelId);
    expect(s.port.panelIn(room)).toMatchObject({ locked: false, hidden: false });
  });

  it('posts a new panel when the old one was deleted', async () => {
    const s = setup();
    const owner = s.port.addMember('Padrinho');
    const room = await s.roomWith(owner);
    const old = s.rooms.get(room)!.panelMessageId!;
    s.port.panels.delete(old);

    await s.voice.manage(actor(owner), room, { type: 'lock' });
    expect(s.rooms.get(room)!.panelMessageId).not.toBe(old);
    expect(s.port.panelIn(room)).toMatchObject({ locked: true });
  });

  it('sets the user limit and rejects one out of range', async () => {
    const s = setup();
    const owner = s.port.addMember('Padrinho');
    const room = await s.roomWith(owner);

    expect(await s.voice.manage(actor(owner), room, { type: 'limit', limit: 5 })).toEqual({
      status: 'ok',
      value: t.limited(5),
    });
    expect(s.voice.describe(room)?.userLimit).toBe(5);
    expect(s.port.panelIn(room)?.userLimit).toBe(5);
    for (const limit of [100, -1, 2.5, Number.NaN]) {
      expect(await s.voice.manage(actor(owner), room, { type: 'limit', limit })).toEqual(
        rejected(t.limitInvalid),
      );
    }
  });

  it('kicks someone out for good, but not yourself or someone elsewhere', async () => {
    const s = setup();
    const [owner, guest, outsider] = ['Padrinho', 'Bia', 'Caio'].map((name) =>
      s.port.addMember(name),
    );
    const room = await s.roomWith(owner!, guest!);
    const as = actor(owner!);

    expect(await s.voice.manage(as, room, { type: 'kick', userId: guest! })).toEqual({
      status: 'ok',
      value: t.kicked('Bia'),
    });
    expect(s.port.voiceChannelOf(guest!)).toBeNull();
    expect(s.overwriteFor(room, guest!)).toMatchObject({ allow: 0n, deny: OCCUPANT_ALLOW });

    await s.voice.manage(as, room, { type: 'lock' });
    await s.voice.manage(as, room, { type: 'unlock' });
    expect(s.overwriteFor(room, guest!)?.deny).toBe(OCCUPANT_ALLOW);

    expect(await s.voice.manage(as, room, { type: 'kick', userId: owner! })).toEqual(
      rejected(t.cannotKickSelf),
    );
    expect(await s.voice.manage(as, room, { type: 'kick', userId: outsider! })).toEqual(
      rejected(t.notInThisRoom),
    );
  });

  it('lets anyone inside claim a room once its owner left; before that only an officer', async () => {
    const s = setup();
    const [owner, guest, officer] = ['Padrinho', 'Bia', 'Oficial'].map((name) =>
      s.port.addMember(name),
    );
    const room = await s.roomWith(owner!, guest!);

    expect(await s.voice.manage(actor(owner!), room, { type: 'claim' })).toEqual(
      rejected(t.alreadyOwner),
    );
    expect(await s.voice.manage(actor(guest!), room, { type: 'claim' })).toEqual(
      rejected(t.ownerPresent),
    );

    await s.leave(owner!);
    expect(await s.voice.manage(actor(guest!, 'visitor'), room, { type: 'claim' })).toEqual({
      status: 'ok',
      value: t.claimed,
    });
    expect(s.voice.describe(room)?.ownerId).toBe(guest);
    expect(s.overwriteFor(room, owner!)).toBeUndefined();
    expect(s.overwriteFor(room, guest!)?.allow).toBe(OWNER_ALLOW);
    expect(s.port.panelIn(room)?.ownerId).toBe(guest);

    await s.join(officer!, room);
    expect(await s.voice.manage(actor(officer!, 'officer'), room, { type: 'claim' })).toEqual({
      status: 'ok',
      value: t.claimed,
    });
    expect(s.voice.describe(room)?.ownerId).toBe(officer);
    expect(s.audited()).toEqual([{ action: 'voice.temp.manage', by: officer, result: 'ok' }]);
  });

  it('lets the owner and officers manage a room, and nobody else', async () => {
    const s = setup();
    const [owner, soldier, officer] = ['Padrinho', 'Bia', 'Oficial'].map((name) =>
      s.port.addMember(name),
    );
    const room = await s.roomWith(owner!, soldier!, officer!);

    expect(await s.voice.manage(actor(soldier!, 'soldier'), room, { type: 'lock' })).toEqual(
      rejected(t.notOwner),
    );
    expect(s.voice.check(actor(soldier!, 'soldier'), room, 'kick')).toEqual({
      allowed: false,
      reason: t.notOwner,
    });
    expect(await s.voice.manage(actor(officer!, 'officer'), room, { type: 'lock' })).toEqual({
      status: 'ok',
      value: t.locked,
    });
    expect(await s.voice.manage(actor(owner!, 'visitor'), room, { type: 'unlock' })).toEqual({
      status: 'ok',
      value: t.unlocked,
    });
    expect(s.audited()).toEqual([{ action: 'voice.temp.manage', by: officer, result: 'ok' }]);

    expect(await s.voice.manage(actor(owner!), null, { type: 'lock' })).toEqual(
      rejected(t.notInRoom),
    );
    expect(await s.voice.manage(actor(owner!), s.generator, { type: 'lock' })).toEqual(
      rejected(t.notInRoom),
    );
  });

  it('keeps renames inside the budget Discord allows, by the clock', async () => {
    const s = setup();
    const owner = s.port.addMember('Padrinho');
    const room = await s.roomWith(owner);
    const as = actor(owner);
    const first = s.clock.now;

    expect(await s.voice.manage(as, room, { type: 'rename', name: '  Raid  ' })).toEqual({
      status: 'ok',
      value: t.renamed('Raid'),
    });
    expect(s.voice.describe(room)?.name).toBe('Raid');
    expect(await s.voice.manage(as, room, { type: 'rename', name: '   ' })).toEqual(
      rejected(t.nameInvalid),
    );
    s.clock.now += MINUTE;
    await s.voice.manage(as, room, { type: 'rename', name: 'Raid 2' });

    s.clock.now += MINUTE;
    const limited = rejected(t.renameLimited(new Date(first + RENAME_WINDOW_MS)));
    expect(await s.voice.manage(as, room, { type: 'rename', name: 'Raid 3' })).toEqual(limited);
    expect(s.voice.check(as, room, 'rename')).toEqual({ allowed: false, reason: limited.reason });

    s.clock.now = first + RENAME_WINDOW_MS;
    s.port.holdRenames = true;
    expect(await s.voice.manage(as, room, { type: 'rename', name: 'Raid 3' })).toEqual({
      status: 'ok',
      value: t.renameQueued('Raid 3'),
    });
  });
});

describe('VoiceService reads', () => {
  it('describes the room for the panel, bots included', async () => {
    const s = setup();
    const [owner, guest] = ['Padrinho', 'Bia'].map((name) => s.port.addMember(name));
    const bot = s.port.addMember('Jockie Music', { bot: true });
    const room = await s.roomWith(owner!, guest!);
    s.port.connect(bot, room);

    const check = s.voice.check(actor(owner!), room, 'kick');
    expect(check).toMatchObject({
      allowed: true,
      room: { id: room, name: 'Abismo 01', userLimit: 20, ownerId: owner, locked: false },
    });
    expect(check.allowed && check.room.occupants.map((o) => [o.displayName, o.bot])).toEqual([
      ['Padrinho', false],
      ['Bia', false],
      ['Jockie Music', true],
    ]);
  });

  it('knows which temp room someone is in', async () => {
    const s = setup();
    const [owner, waiting] = ['Padrinho', 'Bia'].map((name) => s.port.addMember(name));
    const room = await s.roomWith(owner!);
    s.port.connect(waiting!, s.generator);

    expect(s.voice.roomOf(owner!)).toBe(room);
    expect(s.voice.roomOf(waiting!)).toBeNull();
    await s.leave(owner!);
    expect(s.voice.roomOf(owner!)).toBeNull();
  });
});
