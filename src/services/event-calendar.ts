import { createHash } from 'node:crypto';
import { ConfigError } from '../config/loader.js';
import { CLOCK_PATTERN, type EventTemplateConfig } from '../config/schema.js';
import type { ConfigStore, EventTemplatePatch } from '../config/store.js';
import { rejected, type ActionRunner, type Rejected, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import {
  localParts,
  normalizeClock,
  parseDays,
  parseWhen,
  reminderDecision,
  templateOccurrences,
  unixSeconds as unix,
} from '../core/schedule.js';
import type { EventStore, OccurrenceRow, ReminderRow, RsvpStatus } from '../db/events.js';
import type { ManagedObjectStore } from '../db/managed-objects.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';

const t = ptBR.events;
const MINUTE = 60_000;
const TICK_MS = 30_000;
const WINDOW_MS = 7 * 24 * 60 * MINUTE;
const LOOKBACK_MS = 15 * MINUTE;
export const AGENDA_MESSAGE_KEY = 'agenda';

export interface OccurrenceView {
  occurrenceId: number;
  title: string;
  emoji: string;
  description: string | null;
  startsAt: Date;
  voiceChannelId: string | null;
  ping: boolean;
  cancelled: boolean;
  eventId: number | null;
  templateKey: string | null;
}

export interface RsvpSummary {
  yes: string[];
  maybe: string[];
  no: string[];
}

export interface ClassCount {
  name: string;
  count: number;
}

export interface ReminderMessage {
  occurrence: OccurrenceView;
  offsetMinutes: number;
  rsvp: RsvpSummary;
  /** The classes of who said yes, most common first. */
  classes: ClassCount[];
  /** Posted for a time the event no longer has; the reminders for the new time come later. */
  superseded: boolean;
}

export interface AnnouncementPort {
  postReminder(message: ReminderMessage): Promise<string>;
  refreshReminder(messageId: string, message: ReminderMessage): Promise<void>;
  upsertAgenda(messageId: string | null, items: OccurrenceView[], now: Date): Promise<string>;
}

export interface TickReport {
  sent: number;
  skipped: number;
  failed: number;
  agendaUpdated: boolean;
}

export interface NewEvent {
  title: string;
  /** As people type it: "30/10 21:00", "sáb 21h", "amanhã 20:30". */
  when: string;
  description?: string;
  voiceChannelId?: string;
  emoji?: string;
  ping?: boolean;
}

export interface EventEdit {
  title?: string;
  when?: string;
  description?: string;
}

export interface TemplateEdit {
  /** "21:00", "21h", "9h30". */
  time?: string;
  /** "seg qui sáb", "mon,thu,sat", "todo dia". */
  days?: string;
  title?: string;
  enabled?: boolean;
  /** Where the new values came from, for the audit. */
  source?: string;
}

interface Deps {
  store: EventStore;
  managed: ManagedObjectStore;
  config: Pick<ConfigStore, 'get' | 'updateEventTemplate'>;
  runAction: ActionRunner;
  port: AnnouncementPort;
  /** Names of the class roles a member has. */
  classesOf: (userId: string) => string[];
  logger: Logger;
  now?: () => Date;
}

/**
 * The legion's events: one-off ones and the occurrences of the server.yaml templates, their
 * reminders, RSVPs and the pinned agenda. Every change goes through here, whoever makes it.
 */
export class EventCalendar implements BackgroundJob {
  private readonly now: () => Date;
  private agendaChecked = false;
  private running: Promise<TickReport> | undefined;
  private queued: Promise<TickReport> | undefined;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
  }

  start(): () => void {
    return repeat(
      TICK_MS,
      () => this.tick(),
      (error) => this.deps.logger.error({ err: error }, 'event calendar tick failed'),
    );
  }

  /** Syncs the template occurrences, schedules and sends the due reminders, then the agenda. */
  tick(): Promise<TickReport> {
    if (!this.running) {
      this.running = this.runTick().finally(() => (this.running = undefined));
      return this.running;
    }
    // A change made while a tick runs can come too late for it, so one more follows.
    this.queued ??= this.running
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => {
        this.queued = undefined;
        return this.tick();
      });
    return this.queued;
  }

  async create(actor: Actor, input: NewEvent): Promise<ServiceOutcome<string>> {
    const startsAt = this.futureTime(input.when);
    if (!(startsAt instanceof Date)) return startsAt;

    const defaultPing = this.deps.config.get().settings.eventDefaults.ping === 'everyone';
    return this.deps.runAction({
      actor,
      action: 'event.create',
      target: input.title,
      params: { ...input, startsAt: startsAt.toISOString() },
      preview: input.title,
      execute: async () => {
        const { occurrence } = this.deps.store.createEvent({
          title: input.title,
          emoji: input.emoji ?? '📅',
          description: input.description ?? null,
          startsAt,
          voiceChannelId: input.voiceChannelId ?? null,
          ping: input.ping ?? defaultPing,
          createdBy: actor.userId,
        });
        this.refreshSoon();
        return t.created(occurrence.id, input.title, unix(startsAt));
      },
    });
  }

  async edit(
    actor: Actor,
    occurrenceId: number,
    input: EventEdit,
  ): Promise<ServiceOutcome<string>> {
    const { store } = this.deps;
    const occurrence = store.getOccurrence(occurrenceId);
    if (!occurrence) return rejected(t.notFound(occurrenceId));
    if (occurrence.eventId === null) return rejected(t.templateOnlyEdit);
    if (occurrence.cancelledAt) return rejected(t.alreadyCancelled);

    const startsAt = input.when === undefined ? undefined : this.futureTime(input.when);
    if (startsAt !== undefined && !(startsAt instanceof Date)) return startsAt;
    const moved = startsAt !== undefined && startsAt.getTime() !== occurrence.startsAt.getTime();

    const eventId = occurrence.eventId;
    return this.deps.runAction({
      actor,
      action: 'event.edit',
      target: `#${occurrenceId}`,
      params: { ...input, ...(startsAt && { startsAt: startsAt.toISOString() }) },
      preview: `#${occurrenceId}`,
      execute: async () => {
        const posted = store.postedReminders(occurrenceId);
        store.updateEvent(eventId, {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(moved && { startsAt }),
        });
        await this.refreshCards(occurrenceId, posted);
        this.refreshSoon();
        return t.edited(occurrenceId);
      },
    });
  }

  async cancel(
    actor: Actor,
    occurrenceId: number,
    confirm: boolean,
  ): Promise<ServiceOutcome<string>> {
    const view = this.findView(occurrenceId);
    if (!view) return rejected(t.notFound(occurrenceId));
    if (view.cancelled) return rejected(t.alreadyCancelled);

    return this.deps.runAction({
      actor,
      action: 'event.cancel',
      target: `#${occurrenceId} ${view.title}`,
      params: { occurrenceId, startsAt: view.startsAt.toISOString() },
      confirm,
      preview: t.cancelPreview(occurrenceId, view.title, unix(view.startsAt)),
      execute: async () => {
        this.deps.store.cancelOccurrence(occurrenceId, this.now());
        await this.refreshCards(occurrenceId, this.deps.store.postedReminders(occurrenceId));
        this.refreshSoon();
        return t.cancelled(occurrenceId);
      },
    });
  }

  async vote(
    actor: Actor,
    occurrenceId: number,
    status: RsvpStatus,
  ): Promise<ServiceOutcome<string>> {
    const view = this.findView(occurrenceId);
    if (!view || view.cancelled) return rejected(t.gone);
    return this.deps.runAction({
      actor,
      action: 'event.rsvp',
      preview: 'event.rsvp',
      execute: async () => {
        this.deps.store.setRsvp(occurrenceId, actor.userId, status, this.now());
        await this.refreshCards(occurrenceId, this.deps.store.postedReminders(occurrenceId));
        return t.voted(t.statusName[status], view.title);
      },
    });
  }

  /** The events of the next 7 days. */
  async list(actor: Actor): Promise<ServiceOutcome<OccurrenceView[]>> {
    return this.deps.runAction({
      actor,
      action: 'event.read',
      preview: 'event.read',
      execute: async () => this.upcoming(this.now()),
    });
  }

  async rsvps(
    actor: Actor,
    occurrenceId: number,
  ): Promise<ServiceOutcome<{ view: OccurrenceView; rsvp: RsvpSummary }>> {
    const view = this.findView(occurrenceId);
    if (!view) return rejected(t.notFound(occurrenceId));
    return this.deps.runAction({
      actor,
      action: 'event.rsvps.read',
      preview: 'event.rsvps.read',
      execute: async () => ({ view, rsvp: this.rsvpSummary(occurrenceId) }),
    });
  }

  async templates(actor: Actor): Promise<ServiceOutcome<EventTemplateConfig[]>> {
    return this.deps.runAction({
      actor,
      action: 'event.read',
      preview: 'event.read',
      execute: async () => this.deps.config.get().eventTemplates,
    });
  }

  async updateTemplate(
    actor: Actor,
    key: string,
    edit: TemplateEdit,
  ): Promise<ServiceOutcome<string>> {
    const { config } = this.deps;
    if (!config.get().eventTemplates.some((tpl) => tpl.key === key)) {
      return rejected(t.templateUnknown(key));
    }
    const patch = templatePatch(edit);
    if ('status' in patch) return patch;

    try {
      return await this.deps.runAction({
        actor,
        action: 'event.template.edit',
        target: key,
        params: { ...patch, ...(edit.source && { source: edit.source }) },
        preview: key,
        execute: async () => {
          config.updateEventTemplate(key, patch);
          this.refreshSoon();
          return t.templateUpdated(key);
        },
      });
    } catch (error) {
      if (error instanceof ConfigError) return rejected(t.templateInvalid(error.message));
      throw error;
    }
  }

  private refreshSoon(): void {
    void this.tick().catch(() => undefined);
  }

  private futureTime(when: string): Date | Rejected {
    const startsAt = parseWhen(when, this.now(), this.deps.config.get().settings.timezone);
    if (!startsAt) return rejected(t.badWhen);
    if (startsAt <= this.now()) return rejected(t.inPast);
    return startsAt;
  }

  private findView(occurrenceId: number): OccurrenceView | null {
    const occurrence = this.deps.store.getOccurrence(occurrenceId);
    return occurrence ? this.view(occurrence) : null;
  }

  /** What occurrence #N is today: its event, or its template as server.yaml has it now. */
  private view(occurrence: OccurrenceRow): OccurrenceView | null {
    const config = this.deps.config.get();
    const defaultPing = config.settings.eventDefaults.ping === 'everyone';
    const base = {
      occurrenceId: occurrence.id,
      startsAt: occurrence.startsAt,
      cancelled: occurrence.cancelledAt !== null,
      eventId: occurrence.eventId,
      templateKey: occurrence.templateKey,
    };

    if (occurrence.templateKey) {
      const template = config.eventTemplates.find((tpl) => tpl.key === occurrence.templateKey);
      if (!template?.enabled) return null;
      return {
        ...base,
        title: template.title,
        emoji: template.emoji,
        description: template.description ?? null,
        voiceChannelId: template.voiceChannel
          ? (this.deps.managed.get('channel', template.voiceChannel)?.discordId ?? null)
          : null,
        ping: template.ping ?? defaultPing,
      };
    }

    const event = occurrence.eventId ? this.deps.store.getEvent(occurrence.eventId) : undefined;
    if (!event) return null;
    return {
      ...base,
      title: event.title,
      emoji: event.emoji,
      description: event.description,
      voiceChannelId: event.voiceChannelId,
      ping: event.ping,
    };
  }

  private upcoming(now: Date): OccurrenceView[] {
    return this.deps.store
      .occurrencesBetween(now, new Date(now.getTime() + WINDOW_MS))
      .map((o) => this.view(o))
      .filter((v): v is OccurrenceView => v !== null && !v.cancelled);
  }

  private offsetsFor(occurrence: OccurrenceRow): number[] {
    const config = this.deps.config.get();
    const template = occurrence.templateKey
      ? config.eventTemplates.find((tpl) => tpl.key === occurrence.templateKey)
      : undefined;
    return template?.reminderOffsetsMinutes ?? config.settings.eventDefaults.reminderOffsetsMinutes;
  }

  private rsvpSummary(occurrenceId: number): RsvpSummary {
    const summary: RsvpSummary = { yes: [], maybe: [], no: [] };
    for (const { userId, status } of this.deps.store.rsvpsFor(occurrenceId)) {
      summary[status].push(userId);
    }
    return summary;
  }

  private classBreakdown(userIds: string[]): ClassCount[] {
    const counts = new Map<string, number>();
    for (const userId of userIds) {
      for (const name of this.deps.classesOf(userId)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  private message(
    view: OccurrenceView,
    reminder: ReminderRow,
    rsvp: RsvpSummary = this.rsvpSummary(view.occurrenceId),
  ): ReminderMessage {
    return {
      occurrence: view,
      offsetMinutes: reminder.offsetMinutes,
      rsvp,
      classes: this.classBreakdown(rsvp.yes),
      superseded:
        reminder.dueAt.getTime() + reminder.offsetMinutes * MINUTE !== view.startsAt.getTime(),
    };
  }

  /** Brings the reminder cards already in the channel up to date with the occurrence. */
  private async refreshCards(occurrenceId: number, posted: ReminderRow[]): Promise<void> {
    const occurrence = this.deps.store.getOccurrence(occurrenceId);
    const view = occurrence && this.view(occurrence);
    if (!view) return;
    const rsvp = this.rsvpSummary(occurrenceId);
    for (const reminder of posted) {
      await this.deps.port
        .refreshReminder(reminder.messageId!, this.message(view, reminder, rsvp))
        .catch((error: unknown) =>
          this.deps.logger.warn({ err: error, reminder: reminder.id }, 'reminder refresh failed'),
        );
    }
  }

  private async runTick(): Promise<TickReport> {
    const now = this.now();
    const until = new Date(now.getTime() + WINDOW_MS);
    this.syncTemplateOccurrences(now, until);
    this.scheduleReminders(now, until);
    const report = await this.sendDueReminders(now);
    report.agendaUpdated = await this.refreshAgenda(now);
    return report;
  }

  /** The templates' occurrences in the window exist, and ones no template wants any more go. */
  private syncTemplateOccurrences(now: Date, until: Date): void {
    const { store } = this.deps;
    const config = this.deps.config.get();
    const wanted = new Set<string>();
    for (const template of config.eventTemplates.filter((tpl) => tpl.enabled)) {
      for (const startsAt of templateOccurrences(template, now, until, config.settings.timezone)) {
        store.ensureTemplateOccurrence(template.key, startsAt);
        wanted.add(`${template.key}@${startsAt.getTime()}`);
      }
    }
    for (const occurrence of store.untouchedTemplateOccurrences(now)) {
      if (!wanted.has(`${occurrence.templateKey}@${occurrence.startsAt.getTime()}`)) {
        store.deleteOccurrence(occurrence.id);
      }
    }
  }

  private scheduleReminders(now: Date, until: Date): void {
    const { store } = this.deps;
    const recent = new Date(now.getTime() - LOOKBACK_MS);
    for (const occurrence of store.occurrencesBetween(recent, until)) {
      if (occurrence.cancelledAt || !this.view(occurrence)) continue;
      for (const offset of this.offsetsFor(occurrence)) {
        store.ensureReminder(
          occurrence.id,
          offset,
          new Date(occurrence.startsAt.getTime() - offset * MINUTE),
        );
      }
    }
  }

  private async sendDueReminders(now: Date): Promise<TickReport> {
    const { store, logger } = this.deps;
    const report: TickReport = { sent: 0, skipped: 0, failed: 0, agendaUpdated: false };
    for (const reminder of store.dueReminders(now)) {
      const occurrence = store.getOccurrence(reminder.occurrenceId);
      const view = occurrence && this.view(occurrence);
      const decision = reminderDecision(reminder.dueAt, now, reminder.offsetMinutes);
      const stillWanted =
        occurrence !== undefined && this.offsetsFor(occurrence).includes(reminder.offsetMinutes);
      if (!view || view.cancelled || !stillWanted || decision === 'skip') {
        store.skipReminder(reminder.id, now);
        report.skipped++;
        continue;
      }
      if (decision !== 'send' || !store.claimReminder(reminder.id, now)) continue;

      try {
        const messageId = await this.deps.port.postReminder(this.message(view, reminder));
        store.setReminderMessage(reminder.id, messageId);
        report.sent++;
      } catch (error) {
        store.releaseReminder(reminder.id);
        report.failed++;
        logger.warn({ err: error, reminder: reminder.id }, 'failed to post reminder; will retry');
      }
    }
    return report;
  }

  private async refreshAgenda(now: Date): Promise<boolean> {
    const items = this.upcoming(now);
    const timeZone = this.deps.config.get().settings.timezone;
    const today = localParts(now, timeZone);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          // The agenda labels days "Hoje" and "Amanhã", so it changes at local midnight too.
          timeZone,
          [today.year, today.month, today.day],
          items.map((i) => [
            i.occurrenceId,
            i.title,
            i.emoji,
            i.startsAt.getTime(),
            i.voiceChannelId,
          ]),
        ]),
      )
      .digest('hex')
      .slice(0, 16);
    const current = this.deps.managed.get('message', AGENDA_MESSAGE_KEY);
    if (this.agendaChecked && current?.fingerprint === fingerprint) return false;

    try {
      const messageId = await this.deps.port.upsertAgenda(current?.discordId ?? null, items, now);
      this.deps.managed.set('message', AGENDA_MESSAGE_KEY, messageId, fingerprint);
      this.agendaChecked = true;
      return true;
    } catch (error) {
      this.deps.logger.warn({ err: error }, 'failed to update the agenda');
      return false;
    }
  }
}

function templatePatch(edit: TemplateEdit): EventTemplatePatch | Rejected {
  const patch: EventTemplatePatch = {};
  if (edit.time !== undefined) {
    const time = normalizeClock(edit.time);
    if (!CLOCK_PATTERN.test(time)) return rejected(t.badTime(edit.time));
    patch.time = time;
  }
  if (edit.days !== undefined) {
    const days = parseDays(edit.days);
    if (!days) return rejected(t.badDays(edit.days));
    patch.days = days;
  }
  if (edit.title !== undefined) patch.title = edit.title;
  if (edit.enabled !== undefined) patch.enabled = edit.enabled;
  if (Object.keys(patch).length === 0) return rejected(t.templateNoChange);
  return patch;
}
