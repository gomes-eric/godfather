import { pino } from 'pino';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadServerConfig } from '../config/loader.js';
import type { ServerConfig } from '../config/schema.js';
import { openDatabase, type DatabaseHandle } from '../db/client.js';
import { EventStore } from '../db/events.js';
import { ManagedObjectStore } from '../db/managed-objects.js';
import {
  AGENDA_MESSAGE_KEY,
  ReminderScheduler,
  type AnnouncementPort,
  type OccurrenceView,
  type ReminderMessage,
} from './reminder.scheduler.js';

const repoConfig = loadServerConfig(fileURLToPath(new URL('../../server.yaml', import.meta.url)));
const logger = pino({ level: 'silent' });

/** Only the Abyss war template, so expectations stay readable. */
function warOnly(): ServerConfig {
  const config = structuredClone(repoConfig);
  config.eventTemplates = config.eventTemplates.filter((t) => t.key === 'abyss-war');
  return config;
}

// Monday 2026-10-26 in São Paulo (UTC-3). The war starts at 21:00 BRT = 00:00Z on the 27th.
const brt = (hhmm: string, day = 26) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, day, h! + 3, m!));
};

class FakePort implements AnnouncementPort {
  posts: ReminderMessage[] = [];
  refreshes: { messageId: string; message: ReminderMessage }[] = [];
  agendas: OccurrenceView[][] = [];
  failPosts = 0;
  private nextId = 1;

  async postReminder(message: ReminderMessage): Promise<string> {
    if (this.failPosts > 0) {
      this.failPosts--;
      throw new Error('Discord is down');
    }
    this.posts.push(message);
    return `msg-${this.nextId++}`;
  }
  async refreshReminder(messageId: string, message: ReminderMessage): Promise<void> {
    this.refreshes.push({ messageId, message });
  }
  async upsertAgenda(messageId: string | null, items: OccurrenceView[]): Promise<string> {
    this.agendas.push(items);
    return messageId ?? `agenda-${this.nextId++}`;
  }
  summary() {
    return this.posts.map((p) => `${p.occurrence.title}@${p.offsetMinutes}`);
  }
}

describe('ReminderScheduler', () => {
  let handle: DatabaseHandle;
  let store: EventStore;
  let managed: ManagedObjectStore;
  let port: FakePort;
  let clock: Date;
  let config: ServerConfig;

  const scheduler = () =>
    new ReminderScheduler({ store, managed, config: () => config, port, logger, now: () => clock });

  beforeEach(() => {
    handle = openDatabase(':memory:');
    store = new EventStore(handle.db);
    managed = new ManagedObjectStore(handle.db);
    port = new FakePort();
    config = warOnly();
  });
  afterEach(() => handle.close());

  it('sends the 30-minute and the start reminder exactly once each', async () => {
    const s = scheduler();
    const war = 'Guerra do Abismo — Cerco de Artefatos';

    for (const time of ['20:25', '20:30', '20:30', '20:45', '21:00', '21:00', '21:05']) {
      clock = brt(time);
      await s.tick();
    }

    expect(port.summary()).toEqual([`${war}@30`, `${war}@0`]);
  });

  it('survives a restart without duplicating or losing reminders', async () => {
    clock = brt('20:30');
    await scheduler().tick();

    // "Restart": a brand-new scheduler on the same database.
    clock = brt('21:02');
    await scheduler().tick();
    clock = brt('21:03');
    await scheduler().tick();

    expect(port.posts.map((p) => p.offsetMinutes)).toEqual([30, 0]);
  });

  it('skips a reminder that is too late because the bot was off', async () => {
    clock = brt('20:40'); // 10 minutes after the 30-minute warning was due
    await scheduler().tick();
    clock = brt('21:00');
    await scheduler().tick();

    expect(port.posts.map((p) => p.offsetMinutes)).toEqual([0]);
  });

  it('retries a reminder whose post failed', async () => {
    const s = scheduler();
    port.failPosts = 1;
    clock = brt('20:30');
    const first = await s.tick();
    clock = brt('20:31');
    const second = await s.tick();

    expect(first).toMatchObject({ sent: 0, failed: 1 });
    expect(second).toMatchObject({ sent: 1, failed: 0 });
    expect(port.posts).toHaveLength(1);
  });

  it('moves future occurrences when a template time changes', async () => {
    const s = scheduler();
    clock = brt('10:00');
    await s.tick();

    config.eventTemplates[0]!.time = '20:00';
    for (const time of ['19:30', '20:00', '20:30', '21:00']) {
      clock = brt(time);
      await s.tick();
    }

    expect(port.posts.map((p) => p.occurrence.startsAt.toISOString())).toEqual([
      brt('20:00').toISOString(),
      brt('20:00').toISOString(),
    ]);
  });

  it('stops reminding when a template is disabled', async () => {
    const s = scheduler();
    clock = brt('10:00');
    await s.tick();

    config.eventTemplates[0]!.enabled = false;
    clock = brt('20:30');
    await s.tick();

    expect(port.posts).toEqual([]);
    expect(store.occurrencesBetween(brt('00:00'), brt('23:59', 31))).toEqual([]);
  });

  it('skips the reminders of a cancelled occurrence', async () => {
    const s = scheduler();
    clock = brt('10:00');
    await s.tick();
    const [occurrence] = store.occurrencesBetween(brt('20:00'), brt('22:00'));
    store.cancelOccurrence(occurrence!.id, clock);

    clock = brt('20:30');
    const report = await s.tick();
    expect(report).toMatchObject({ sent: 0, skipped: 1 });
  });

  it('reminds one-off events and uses their own ping setting', async () => {
    config.eventTemplates = [];
    const { occurrence } = store.createEvent({
      title: 'Raid de sábado',
      emoji: '🗡️',
      startsAt: brt('20:00', 31),
      ping: false,
      createdBy: 'officer',
    });

    clock = brt('19:30', 31);
    await scheduler().tick();

    expect(port.posts).toHaveLength(1);
    expect(port.posts[0]!.occurrence).toMatchObject({
      occurrenceId: occurrence.id,
      title: 'Raid de sábado',
      ping: false,
    });
  });

  it('refreshes posted reminders when someone votes', async () => {
    const s = scheduler();
    clock = brt('20:30');
    await s.tick();
    const occurrenceId = port.posts[0]!.occurrence.occurrenceId;

    await s.vote(occurrenceId, 'u1', 'yes');
    const summary = await s.vote(occurrenceId, 'u2', 'maybe');
    await s.vote(occurrenceId, 'u1', 'no'); // changing a vote replaces it

    expect(summary).toEqual({ yes: ['u1'], maybe: ['u2'], no: [] });
    expect(s.rsvpSummary(occurrenceId)).toEqual({ yes: [], maybe: ['u2'], no: ['u1'] });
    expect(port.refreshes.map((r) => r.messageId)).toEqual(['msg-1', 'msg-1', 'msg-1']);
  });

  it('rewrites the agenda once after startup, then only when it changes', async () => {
    const s = scheduler();
    clock = brt('10:00');
    await s.tick();
    clock = brt('10:01');
    await s.tick();
    expect(port.agendas).toHaveLength(1);
    expect(port.agendas[0]!.map((i) => i.title)).toHaveLength(3); // mon, thu, sat

    config.eventTemplates[0]!.title = 'Guerra!';
    clock = brt('10:02');
    await s.tick();
    expect(port.agendas).toHaveLength(2);
    expect(managed.get('message', AGENDA_MESSAGE_KEY)?.discordId).toMatch(/^agenda-/);

    clock = brt('10:03');
    await scheduler().tick(); // restart rewrites once more
    expect(port.agendas).toHaveLength(3);
  });

  it('includes every template from server.yaml in the agenda', async () => {
    config = structuredClone(repoConfig);
    clock = brt('10:00');
    await scheduler().tick();

    const titles = new Set(port.agendas[0]!.map((i) => i.title));
    expect(titles).toEqual(new Set(repoConfig.eventTemplates.map((t) => t.title)));
  });
});

describe('parseDays', () => {
  it('accepts English and Portuguese day names', async () => {
    const { parseDays } = await import('./event.service.js');
    expect(parseDays('mon,thu,sat')).toEqual(['mon', 'thu', 'sat']);
    expect(parseDays('seg qui sáb')).toEqual(['mon', 'thu', 'sat']);
    expect(parseDays('sexta, domingo')).toEqual(['fri', 'sun']);
    expect(parseDays('todo dia')).toEqual(['daily']);
    expect(parseDays('someday')).toBeNull();
  });
});
