import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../config/store.js';
import { createActionRunner, rejected } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import type { AuditEntry } from '../core/audit.js';
import { openDatabase, type DatabaseHandle } from '../db/client.js';
import { EventStore } from '../db/events.js';
import { ManagedObjectStore } from '../db/managed-objects.js';
import { ptBR } from '../i18n/pt-BR.js';
import {
  AGENDA_MESSAGE_KEY,
  EventCalendar,
  type AnnouncementPort,
  type OccurrenceView,
  type ReminderMessage,
} from './event-calendar.js';

const SERVER_YAML = readFileSync(new URL('../../server.yaml', import.meta.url), 'utf8');
const logger = pino({ level: 'silent' });
const t = ptBR.events;
const WAR = 'Guerra do Abismo — Cerco de Artefatos';

const officer: Actor = { userId: 'padrinho', tier: 'officer', source: 'slash' };
const soldier = (userId: string): Actor => ({ userId, tier: 'soldier', source: 'slash' });

/** Brasília wall time in October 2026; the 26th is a Monday. */
const brt = (hhmm: string, day = 26) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, day, h! + 3, m!));
};

class FakePort implements AnnouncementPort {
  posts: ReminderMessage[] = [];
  refreshes: { messageId: string; message: ReminderMessage }[] = [];
  agendas: { items: OccurrenceView[]; now: Date }[] = [];
  failPosts = 0;

  async postReminder(message: ReminderMessage): Promise<string> {
    if (this.failPosts > 0) {
      this.failPosts--;
      throw new Error('Discord is down');
    }
    this.posts.push(message);
    return `msg-${this.posts.length}`;
  }
  async refreshReminder(messageId: string, message: ReminderMessage): Promise<void> {
    this.refreshes.push({ messageId, message });
  }
  async upsertAgenda(messageId: string | null, items: OccurrenceView[], now: Date) {
    this.agendas.push({ items, now });
    return messageId ?? `agenda-${this.agendas.length}`;
  }
  summary() {
    return this.posts.map((p) => `${p.occurrence.title}@${p.offsetMinutes}`);
  }
}

describe('EventCalendar', () => {
  let handle: DatabaseHandle;
  let managed: ManagedObjectStore;
  let config: ConfigStore;
  let path: string;
  let port: FakePort;
  let clock: Date;
  let audit: AuditEntry[];
  let classes: Record<string, string[]>;

  const calendar = () =>
    new EventCalendar({
      store: new EventStore(handle.db),
      managed,
      config,
      runAction: createActionRunner({
        record: async (entry) => {
          audit.push(entry);
          return { ...entry, id: audit.length, at: new Date() };
        },
      }),
      port,
      classesOf: (userId) => classes[userId] ?? [],
      logger,
      now: () => clock,
    });

  const template = (key: string) => config.get().eventTemplates.find((tpl) => tpl.key === key)!;
  const disableTemplates = (...keys: string[]) => {
    for (const key of keys) config.updateEventTemplate(key, { enabled: false });
  };
  const noTemplates = () => disableTemplates('abyss-war');

  beforeEach(() => {
    handle = openDatabase(':memory:');
    managed = new ManagedObjectStore(handle.db);
    path = join(mkdtempSync(join(tmpdir(), 'padrinho-')), 'server.yaml');
    writeFileSync(path, SERVER_YAML);
    config = new ConfigStore(path);
    disableTemplates('abyss-bosses', 'weekly-boss-nahma');
    config.updateEventTemplate('abyss-war', { days: ['mon', 'thu', 'sat'] });
    port = new FakePort();
    clock = brt('10:00');
    audit = [];
    classes = {};
  });
  afterEach(() => handle.close());

  describe('reminders', () => {
    it('sends the 30-minute and the start reminder exactly once each', async () => {
      const cal = calendar();
      for (const time of ['20:25', '20:30', '20:30', '20:45', '21:00', '21:00', '21:05']) {
        clock = brt(time);
        await cal.tick();
      }

      expect(port.summary()).toEqual([`${WAR}@30`, `${WAR}@0`]);
    });

    it('survives a restart without duplicating or losing reminders', async () => {
      clock = brt('20:30');
      await calendar().tick();

      clock = brt('21:02');
      await calendar().tick();
      clock = brt('21:03');
      await calendar().tick();

      expect(port.posts.map((p) => p.offsetMinutes)).toEqual([30, 0]);
    });

    it('skips a reminder that is too late because the bot was off', async () => {
      clock = brt('20:40');
      await calendar().tick();
      clock = brt('21:00');
      await calendar().tick();

      expect(port.posts.map((p) => p.offsetMinutes)).toEqual([0]);
    });

    it('retries a reminder whose post failed', async () => {
      const cal = calendar();
      port.failPosts = 1;
      clock = brt('20:30');
      const first = await cal.tick();
      clock = brt('20:31');
      const second = await cal.tick();

      expect(first).toMatchObject({ sent: 0, failed: 1 });
      expect(second).toMatchObject({ sent: 1, failed: 0 });
      expect(port.posts).toHaveLength(1);
    });

    it('moves future occurrences when a template time changes', async () => {
      const cal = calendar();
      await cal.tick();

      expect(await cal.updateTemplate(officer, 'abyss-war', { time: '20h' })).toMatchObject({
        status: 'ok',
      });
      for (const time of ['19:30', '20:00', '20:30', '21:00']) {
        clock = brt(time);
        await cal.tick();
      }

      expect(port.posts.map((p) => p.occurrence.startsAt)).toEqual([brt('20:00'), brt('20:00')]);
    });

    it('stops reminding when a template is disabled', async () => {
      const cal = calendar();
      await cal.tick();

      await cal.updateTemplate(officer, 'abyss-war', { enabled: false });
      clock = brt('20:30');
      await cal.tick();

      expect(port.posts).toEqual([]);
      expect(await cal.list(officer)).toEqual({ status: 'ok', value: [] });
    });

    it('stops sending a reminder whose offset was taken out of the template', async () => {
      const cal = calendar();
      await cal.tick();

      const yaml = readFileSync(path, 'utf8').replace(
        'shugoEvent: artifact-siege',
        'shugoEvent: artifact-siege\n    reminderOffsetsMinutes: [0]',
      );
      writeFileSync(path, yaml);
      expect(config.reload().eventTemplates[0]!.reminderOffsetsMinutes).toEqual([0]);

      clock = brt('20:30');
      const report = await cal.tick();
      clock = brt('21:00');
      await cal.tick();

      expect(report).toMatchObject({ sent: 0, skipped: 1 });
      expect(port.posts.map((p) => p.offsetMinutes)).toEqual([0]);
    });

    it('reminds one-off events and uses their own ping setting', async () => {
      noTemplates();
      const cal = calendar();
      clock = brt('10:00', 31);
      const created = await cal.create(officer, {
        title: 'Raid de sábado',
        emoji: '🗡️',
        when: '31/10 20:00',
        ping: false,
      });

      clock = brt('19:30', 31);
      await cal.tick();

      expect(created.status).toBe('ok');
      expect(port.posts).toHaveLength(1);
      expect(port.posts[0]!.occurrence).toMatchObject({ title: 'Raid de sábado', ping: false });
    });

    it('schedules the reminders again when a one-off event moves', async () => {
      noTemplates();
      const cal = calendar();
      clock = brt('10:00', 31);
      await cal.create(officer, { title: 'Raid de sábado', when: '31/10 21:00' });
      clock = brt('20:30', 31);
      await cal.tick();
      const id = port.posts[0]!.occurrence.occurrenceId;

      clock = brt('20:40', 31);
      expect(await cal.edit(officer, id, { when: 'hoje 22h' })).toMatchObject({ status: 'ok' });
      for (const time of ['21:00', '21:30', '22:00']) {
        clock = brt(time, 31);
        await cal.tick();
      }

      const at = (hhmm: string) => brt(hhmm, 31).toISOString();
      expect(
        port.posts.map((p) => `${p.offsetMinutes}@${p.occurrence.startsAt.toISOString()}`),
      ).toEqual([`30@${at('21:00')}`, `30@${at('22:00')}`, `0@${at('22:00')}`]);
    });
  });

  describe('posted cards', () => {
    it('follow the votes, with the classes of who is going', async () => {
      classes = { u1: ['Clérigo'], u2: ['Clérigo', 'Gladiador'] };
      const cal = calendar();
      clock = brt('20:30');
      await cal.tick();
      const id = port.posts[0]!.occurrence.occurrenceId;

      await cal.vote(soldier('u1'), id, 'yes');
      await cal.vote(soldier('u2'), id, 'yes');
      expect(await cal.vote(soldier('u3'), id, 'maybe')).toEqual({
        status: 'ok',
        value: t.voted('Talvez', WAR),
      });

      expect(port.refreshes.map((r) => r.messageId)).toEqual(['msg-1', 'msg-1', 'msg-1']);
      expect(port.refreshes.at(-1)!.message).toMatchObject({
        rsvp: { yes: ['u1', 'u2'], maybe: ['u3'], no: [] },
        classes: [
          { name: 'Clérigo', count: 2 },
          { name: 'Gladiador', count: 1 },
        ],
        superseded: false,
      });

      await cal.vote(soldier('u1'), id, 'no');
      expect(await cal.rsvps(officer, id)).toMatchObject({
        status: 'ok',
        value: { rsvp: { yes: ['u2'], maybe: ['u3'], no: ['u1'] } },
      });
    });

    it('show the new title and time when the event is edited', async () => {
      noTemplates();
      const cal = calendar();
      clock = brt('10:00', 31);
      await cal.create(officer, { title: 'Raid de sábado', when: '31/10 21:00' });
      clock = brt('20:30', 31);
      await cal.tick();
      const id = port.posts[0]!.occurrence.occurrenceId;

      await cal.edit(officer, id, { title: 'Raid do Padrinho' });
      expect(port.refreshes.at(-1)).toMatchObject({
        messageId: 'msg-1',
        message: { occurrence: { title: 'Raid do Padrinho' }, superseded: false },
      });

      await cal.edit(officer, id, { when: 'hoje 22h' });
      expect(port.refreshes.at(-1)).toMatchObject({
        messageId: 'msg-1',
        message: { occurrence: { startsAt: brt('22:00', 31) }, superseded: true },
      });
      expect(port.refreshes).toHaveLength(2);
    });

    it('close when the date is cancelled', async () => {
      const cal = calendar();
      clock = brt('20:30');
      await cal.tick();
      const id = port.posts[0]!.occurrence.occurrenceId;

      expect(await cal.cancel(officer, id, false)).toMatchObject({
        status: 'confirmation_required',
      });
      expect(port.refreshes).toEqual([]);
      expect(await cal.cancel(officer, id, true)).toEqual({ status: 'ok', value: t.cancelled(id) });
      expect(port.refreshes).toEqual([
        {
          messageId: 'msg-1',
          message: expect.objectContaining({
            occurrence: expect.objectContaining({ cancelled: true }),
          }),
        },
      ]);

      clock = brt('21:00');
      expect(await cal.tick()).toMatchObject({ sent: 0, skipped: 1 });
      expect(port.posts).toHaveLength(1);
    });
  });

  describe('agenda', () => {
    it('is rewritten once after startup, then only when it changes', async () => {
      const cal = calendar();
      await cal.tick();
      clock = brt('10:01');
      await cal.tick();
      expect(port.agendas).toHaveLength(1);
      expect(port.agendas[0]!.items).toHaveLength(3);

      await cal.updateTemplate(officer, 'abyss-war', { title: 'Guerra!' });
      clock = brt('10:02');
      await cal.tick();
      expect(port.agendas).toHaveLength(2);
      expect(port.agendas[1]!.items[0]!.title).toBe('Guerra!');
      expect(managed.get('message', AGENDA_MESSAGE_KEY)?.discordId).toMatch(/^agenda-/);

      clock = brt('10:03');
      await calendar().tick();
      expect(port.agendas).toHaveLength(3);
    });

    it('is rewritten after local midnight, so Hoje and Amanhã follow the day', async () => {
      const cal = calendar();
      for (const [time, day] of [
        ['10:00', 28],
        ['23:50', 28],
        ['00:05', 29],
        ['00:06', 29],
      ] as const) {
        clock = brt(time, day);
        await cal.tick();
      }

      expect(port.agendas.map((a) => a.now)).toEqual([brt('10:00', 28), brt('00:05', 29)]);
      expect(port.agendas[1]!.items).toEqual(port.agendas[0]!.items);
    });

    it('includes every template from server.yaml', async () => {
      writeFileSync(path, SERVER_YAML);
      config.reload();
      await calendar().tick();

      const titles = new Set(port.agendas[0]!.items.map((i) => i.title));
      expect(titles).toEqual(new Set(config.get().eventTemplates.map((tpl) => tpl.title)));
    });
  });

  describe('templates', () => {
    it('reads days and times the way people type them', async () => {
      const cal = calendar();

      expect(
        await cal.updateTemplate(officer, 'abyss-war', { days: 'seg qui sáb', time: '21h' }),
      ).toEqual({ status: 'ok', value: t.templateUpdated('abyss-war') });
      expect(template('abyss-war')).toMatchObject({ days: ['mon', 'thu', 'sat'], time: '21:00' });

      await cal.updateTemplate(officer, 'abyss-war', { days: 'todo dia', time: '9h30' });
      expect(template('abyss-war')).toMatchObject({ days: ['daily'], time: '09:30' });
      expect(audit.map((a) => [a.action, a.target, a.result, a.params])).toEqual([
        ['event.template.edit', 'abyss-war', 'ok', { days: ['mon', 'thu', 'sat'], time: '21:00' }],
        ['event.template.edit', 'abyss-war', 'ok', { days: ['daily'], time: '09:30' }],
      ]);
    });

    it('refuses bad days and times, empty edits and edits that break server.yaml', async () => {
      const cal = calendar();
      const before = readFileSync(path, 'utf8');
      const edit = (key: string, change: Parameters<EventCalendar['updateTemplate']>[2]) =>
        cal.updateTemplate(officer, key, change);

      expect(await edit('abyss-war', { days: 'someday' })).toEqual(rejected(t.badDays('someday')));
      expect(await edit('abyss-war', { time: '25h' })).toEqual(rejected(t.badTime('25h')));
      expect(await edit('abyss-war', { time: 'meio-dia' })).toEqual(
        rejected(t.badTime('meio-dia')),
      );
      expect(await edit('abyss-war', {})).toEqual(rejected(t.templateNoChange));
      expect(await edit('nope', { enabled: false })).toEqual(rejected(t.templateUnknown('nope')));
      expect(await edit('abyss-war', { title: 'x'.repeat(101) })).toMatchObject({
        status: 'rejected',
        reason: expect.stringContaining('server.yaml inválido'),
      });

      expect(readFileSync(path, 'utf8')).toBe(before);
    });

    it('lists the templates of server.yaml to soldiers', async () => {
      const outcome = await calendar().templates(soldier('u1'));
      expect(outcome.status === 'ok' && outcome.value.map((tpl) => tpl.key)).toEqual([
        'abyss-war',
        'abyss-bosses',
        'weekly-boss-nahma',
      ]);
    });
  });

  describe('rejections', () => {
    it('refuses a date it cannot read or that already passed', async () => {
      noTemplates();
      const cal = calendar();
      clock = brt('10:00', 31);

      expect(await cal.create(officer, { title: 'Raid', when: 'quando der' })).toEqual(
        rejected(t.badWhen),
      );
      expect(await cal.create(officer, { title: 'Raid', when: 'hoje 9h' })).toEqual(
        rejected(t.inPast),
      );

      await cal.create(officer, { title: 'Raid', when: 'hoje 21h' });
      const id = await eventId(cal, 'Raid');
      expect(await cal.edit(officer, id, { when: 'quando der' })).toEqual(rejected(t.badWhen));
      expect(await cal.edit(officer, id, { when: 'hoje 9h' })).toEqual(rejected(t.inPast));
    });

    it('edits only one-off events that still happen', async () => {
      const cal = calendar();
      await cal.tick();
      const war = await eventId(cal, WAR);

      expect(await cal.edit(officer, 999, { title: 'Raid' })).toEqual(rejected(t.notFound(999)));
      expect(await cal.edit(officer, war, { title: 'Raid' })).toEqual(rejected(t.templateOnlyEdit));

      await cal.create(officer, { title: 'Raid', when: 'hoje 22h' });
      const raid = await eventId(cal, 'Raid');
      await cal.cancel(officer, raid, true);
      expect(await cal.edit(officer, raid, { title: 'Raid 2' })).toEqual(
        rejected(t.alreadyCancelled),
      );
    });

    it('cancels a date only once, and takes no RSVP for it afterwards', async () => {
      const cal = calendar();
      await cal.tick();
      const id = await eventId(cal, WAR);

      expect(await cal.cancel(officer, 999, true)).toEqual(rejected(t.notFound(999)));
      expect(await cal.cancel(officer, id, true)).toMatchObject({ status: 'ok' });
      expect(await cal.cancel(officer, id, true)).toEqual(rejected(t.alreadyCancelled));
      expect(await cal.vote(soldier('u1'), id, 'yes')).toEqual(rejected(t.gone));
      expect(await cal.vote(soldier('u1'), 999, 'yes')).toEqual(rejected(t.gone));
      expect(await cal.rsvps(officer, 999)).toEqual(rejected(t.notFound(999)));
    });

    it('leaves event management to officers', async () => {
      const cal = calendar();
      await cal.tick();

      expect(await cal.create(soldier('u1'), { title: 'Raid', when: 'hoje 22h' })).toEqual({
        status: 'denied',
        requiredTier: 'officer',
      });
      expect(await cal.updateTemplate(soldier('u1'), 'abyss-war', { time: '20h' })).toEqual({
        status: 'denied',
        requiredTier: 'officer',
      });
      expect(template('abyss-war').time).toBe('21:00');
    });
  });
});

async function eventId(cal: EventCalendar, title: string): Promise<number> {
  const listed = await cal.list(officer);
  const found = listed.status === 'ok' ? listed.value.find((v) => v.title === title) : undefined;
  if (!found) throw new Error(`no upcoming "${title}"`);
  return found.occurrenceId;
}
