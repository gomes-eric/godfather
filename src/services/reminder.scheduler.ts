import { createHash } from 'node:crypto';
import type { ServerConfig } from '../config/schema.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import { reminderDecision, templateOccurrences } from '../core/schedule.js';
import type { EventStore, OccurrenceRow, RsvpStatus } from '../db/events.js';
import type { ManagedObjectStore } from '../db/managed-objects.js';
import type { Logger } from '../logger.js';

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

export interface ReminderMessage {
  occurrence: OccurrenceView;
  offsetMinutes: number;
  rsvp: RsvpSummary;
}

export interface AnnouncementPort {
  postReminder(message: ReminderMessage): Promise<string>;
  refreshReminder(messageId: string, message: ReminderMessage): Promise<void>;
  upsertAgenda(messageId: string | null, items: OccurrenceView[]): Promise<string>;
}

export interface TickReport {
  sent: number;
  skipped: number;
  failed: number;
  agendaUpdated: boolean;
}

interface Deps {
  store: EventStore;
  managed: ManagedObjectStore;
  config: () => ServerConfig;
  port: AnnouncementPort;
  logger: Logger;
  now?: () => Date;
}

export class ReminderScheduler implements BackgroundJob {
  private readonly now: () => Date;
  private agendaChecked = false;
  private running: Promise<TickReport> | undefined;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
  }

  start(): () => void {
    return repeat(
      TICK_MS,
      () => this.tick(),
      (error) => this.deps.logger.error({ err: error }, 'reminder tick failed'),
    );
  }

  refreshSoon(): void {
    void this.tick().catch(() => undefined);
  }

  upcoming(now: Date): OccurrenceView[] {
    return this.deps.store
      .occurrencesBetween(now, new Date(now.getTime() + WINDOW_MS))
      .map((o) => this.view(o))
      .filter((v): v is OccurrenceView => v !== null && !v.cancelled);
  }

  tick(): Promise<TickReport> {
    this.running ??= this.runTick().finally(() => (this.running = undefined));
    return this.running;
  }

  view(occurrence: OccurrenceRow): OccurrenceView | null {
    const config = this.deps.config();
    const defaultPing = config.settings.eventDefaults.ping === 'everyone';
    const base = {
      occurrenceId: occurrence.id,
      startsAt: occurrence.startsAt,
      cancelled: occurrence.cancelledAt !== null,
      eventId: occurrence.eventId,
      templateKey: occurrence.templateKey,
    };

    if (occurrence.templateKey) {
      const template = config.eventTemplates.find((t) => t.key === occurrence.templateKey);
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

  rsvpSummary(occurrenceId: number): RsvpSummary {
    const summary: RsvpSummary = { yes: [], maybe: [], no: [] };
    for (const { userId, status } of this.deps.store.rsvpsFor(occurrenceId)) {
      summary[status].push(userId);
    }
    return summary;
  }

  async vote(occurrenceId: number, userId: string, status: RsvpStatus): Promise<RsvpSummary> {
    this.deps.store.setRsvp(occurrenceId, userId, status, this.now());
    const occurrence = this.deps.store.getOccurrence(occurrenceId);
    const view = occurrence && this.view(occurrence);
    const rsvp = this.rsvpSummary(occurrenceId);
    if (view) {
      for (const reminder of this.deps.store.postedReminders(occurrenceId)) {
        await this.deps.port
          .refreshReminder(reminder.messageId!, {
            occurrence: view,
            offsetMinutes: reminder.offsetMinutes,
            rsvp,
          })
          .catch((error: unknown) =>
            this.deps.logger.warn({ err: error, reminder: reminder.id }, 'RSVP refresh failed'),
          );
      }
    }
    return rsvp;
  }

  private offsetsFor(occurrence: OccurrenceRow): number[] {
    const config = this.deps.config();
    const template = occurrence.templateKey
      ? config.eventTemplates.find((t) => t.key === occurrence.templateKey)
      : undefined;
    return template?.reminderOffsetsMinutes ?? config.settings.eventDefaults.reminderOffsetsMinutes;
  }

  private async runTick(): Promise<TickReport> {
    const now = this.now();
    const until = new Date(now.getTime() + WINDOW_MS);
    this.syncTemplateOccurrences(now, until);
    this.scheduleReminders(now, until);
    const report = await this.sendDueReminders(now);
    report.agendaUpdated = await this.refreshAgenda(this.upcoming(now));
    return report;
  }

  /** The templates' occurrences in the window exist, and ones no template wants any more go. */
  private syncTemplateOccurrences(now: Date, until: Date): void {
    const { store, config } = this.deps;
    const timeZone = config().settings.timezone;
    const wanted = new Set<string>();
    for (const template of config().eventTemplates.filter((t) => t.enabled)) {
      for (const startsAt of templateOccurrences(template, now, until, timeZone)) {
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
      if (!view || view.cancelled || decision === 'skip') {
        store.skipReminder(reminder.id, now);
        report.skipped++;
        continue;
      }
      if (decision !== 'send' || !store.claimReminder(reminder.id, now)) continue;

      try {
        const messageId = await this.deps.port.postReminder({
          occurrence: view,
          offsetMinutes: reminder.offsetMinutes,
          rsvp: this.rsvpSummary(view.occurrenceId),
        });
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

  private async refreshAgenda(items: OccurrenceView[]): Promise<boolean> {
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify(
          items.map((i) => [
            i.occurrenceId,
            i.title,
            i.emoji,
            i.startsAt.getTime(),
            i.voiceChannelId,
          ]),
        ),
      )
      .digest('hex')
      .slice(0, 16);
    const current = this.deps.managed.get('message', AGENDA_MESSAGE_KEY);
    if (this.agendaChecked && current?.fingerprint === fingerprint) return false;

    try {
      const messageId = await this.deps.port.upsertAgenda(current?.discordId ?? null, items);
      this.deps.managed.set('message', AGENDA_MESSAGE_KEY, messageId, fingerprint);
      this.agendaChecked = true;
      return true;
    } catch (error) {
      this.deps.logger.warn({ err: error }, 'failed to update the agenda');
      return false;
    }
  }
}
