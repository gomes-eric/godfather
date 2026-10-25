import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../config/store.js';
import { createActionRunner } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { openDatabase, type DatabaseHandle } from '../db/client.js';
import { EventStore } from '../db/events.js';
import { FieldBossStore } from '../db/field-bosses.js';
import { ManagedObjectStore } from '../db/managed-objects.js';
import { FieldBossService } from './field-boss.service.js';
import {
  ReminderScheduler,
  type AnnouncementPort,
  type ReminderMessage,
} from './reminder.scheduler.js';

const logger = pino({ level: 'silent' });
const officer: Actor = { userId: 'officer-1', tier: 'officer', source: 'slash' };
const repoServerYaml = fileURLToPath(new URL('../../server.yaml', import.meta.url));

// 03:40 in São Paulo on 2026-10-25.
const start = new Date('2026-10-25T06:40:00Z');
const minutes = (n: number) => new Date(start.getTime() + n * 60_000);

function feed(entries: { id: number; alive: boolean; time: number; seenAt: number }[]) {
  return { result: { data: entries.map((e) => ({ name: 'x', ...e })) } };
}
const gartuaAt = (respawn: Date, seen = minutes(-5)) =>
  feed([{ id: 111021, alive: false, time: respawn.getTime(), seenAt: seen.getTime() }]);

describe('FieldBossService', () => {
  let handle: DatabaseHandle;
  let config: ConfigStore;
  let store: FieldBossStore;
  let clock: Date;
  let response: unknown;
  let warnings: string[];
  let service: FieldBossService;

  beforeEach(() => {
    const path = join(mkdtempSync(join(tmpdir(), 'padrinho-')), 'server.yaml');
    copyFileSync(repoServerYaml, path);
    config = new ConfigStore(path);
    config.get().fieldBosses!.source.enabled = true; // the repo keeps it off until approved
    handle = openDatabase(':memory:');
    store = new FieldBossStore(handle.db);
    clock = start;
    warnings = [];
    response = gartuaAt(minutes(336));
    service = new FieldBossService({
      store,
      config,
      runAction: createActionRunner({
        record: async (entry) => ({ ...entry, id: 1, at: clock }),
      }),
      logger,
      warn: async (text) => {
        warnings.push(text);
      },
      fetchFeed: async () => {
        if (response instanceof Error) throw response;
        return response;
      },
      now: () => clock,
    });
  });
  afterEach(() => handle.close());

  it('stores the respawn read from the feed (Asmodian id only)', async () => {
    expect(await service.poll()).toBe('ok');
    expect(store.get('gartua')).toMatchObject({ source: 'questlog', respawnAt: minutes(336) });
    expect(store.get('lagta')).toBeUndefined();
  });

  it('does nothing while the feed is disabled in server.yaml', async () => {
    config.get().fieldBosses!.source.enabled = false;
    expect(await service.poll()).toBe('disabled');
    expect(store.all()).toEqual([]);
  });

  it('lets a manual correction win until the respawn passes', async () => {
    await service.set(officer, 'gartua', '09:30'); // 12:30Z
    await service.poll();
    expect(store.get('gartua')).toMatchObject({ source: 'manual', overrideBy: 'officer-1' });

    clock = new Date('2026-10-25T12:31:00Z');
    response = gartuaAt(new Date('2026-10-26T12:00:00Z'), clock);
    await service.poll();
    expect(store.get('gartua')).toMatchObject({ source: 'questlog' });
  });

  it('warns once when the format changes, then waits 6 hours', async () => {
    response = { result: { data: [{ id: 'oops' }] } };
    expect(await service.poll()).toBe('failed');
    clock = minutes(10);
    await service.poll();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('formato');
  });

  it('warns when the feed has been down for more than 15 minutes', async () => {
    await service.poll();
    response = new Error('ECONNRESET');
    clock = minutes(3);
    await service.poll();
    clock = minutes(10);
    await service.poll();
    expect(warnings).toEqual([]);

    clock = minutes(20);
    await service.poll();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('não responde');
  });

  it('warns when nobody refreshed the readings for hours', async () => {
    response = gartuaAt(minutes(336), minutes(-7 * 60));
    await service.poll();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Ninguém atualiza');
  });

  it('needs respawnMinutes for /boss killed', async () => {
    const outcome = await service.killed(officer, 'gartua');
    expect(outcome).toMatchObject({ status: 'rejected' });

    config.get().fieldBosses!.bosses[0]!.respawnMinutes = 1440;
    const ok = await service.killed(officer, 'Gartua Imortal');
    expect(ok.status).toBe('ok');
    expect(store.get('gartua')?.respawnAt).toEqual(minutes(1440));
  });

  it('finds bosses by key or by part of the name, ignoring accents', () => {
    expect(service.resolve('lagta')?.key).toBe('lagta');
    expect(service.resolve('brigadeiro')?.key).toBe('lagta');
    expect(service.resolve('GARTUA IMORTAL')?.key).toBe('gartua');
    expect(service.resolve('nahma')).toBeUndefined();
  });

  it('feeds respawns to the reminder scheduler and moves them when the time changes', async () => {
    const events = new EventStore(handle.db);
    const posts: ReminderMessage[] = [];
    const port: AnnouncementPort = {
      postReminder: async (m) => {
        posts.push(m);
        return `msg-${posts.length}`;
      },
      refreshReminder: async () => undefined,
      upsertAgenda: async (id) => id ?? 'agenda',
    };
    const cfg = structuredClone(config.get());
    cfg.eventTemplates = [];
    const scheduler = new ReminderScheduler({
      store: events,
      managed: new ManagedObjectStore(handle.db),
      config: () => cfg,
      port,
      logger,
      sources: [service],
      now: () => clock,
    });

    await service.poll(); // respawn at +336 min
    await scheduler.tick();
    response = gartuaAt(minutes(350)); // corrected reading
    await service.poll();
    clock = minutes(320); // 30 min before the corrected respawn
    await scheduler.tick();
    clock = minutes(350);
    await scheduler.tick();

    expect(posts.map((p) => [p.occurrence.title, p.offsetMinutes])).toEqual([
      ['Boss Diário — Gartua Imortal', 30],
      ['Boss Diário — Gartua Imortal', 0],
    ]);
    expect(posts[0]!.occurrence).toMatchObject({ rsvp: false, startsAt: minutes(350) });
    expect(posts[0]!.occurrence.description).toContain('Altgard');
  });
});
