import { createHash } from 'node:crypto';
import type { ServerConfig } from '../config/schema.js';
import { reminderDecision, templateOccurrences } from '../core/schedule.js';
import type { EventStore, OccurrenceRow, RsvpStatus } from '../db/events.js';
import type { ManagedObjectStore } from '../db/managed-objects.js';
import type { Logger } from '../logger.js';

const MINUTE = 60_000;
const WINDOW_MS = 7 * 24 * 60 * MINUTE;
/** Occurrences that started this recently still get their "starting now" reminder. */
const LOOKBACK_MS = 15 * MINUTE;
export const AGENDA_MESSAGE_KEY = 'agenda';

/** Everything needed to show an occurrence, whatever its source (template or one-off). */
export interface OccurrenceView {
  occurrenceId: number;
  title: string;
  emoji: string;
  description: string | null;
  startsAt: Date;
  voiceChannelId: string | null;
  ping: boolean;
  cancelled: boolean;
  /** Set for one-off events; templates are identified by key. */
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

/** Where reminders and the agenda are posted. Implemented for Discord in src/discord. */
export interface AnnouncementPort {
  postReminder(message: ReminderMessage): Promise<string>;
  refreshReminder(messageId: string, message: ReminderMessage): Promise<void>;
  /** Edits the agenda message if it exists, otherwise posts it. Returns the message id. */
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

/**
 * Persistent, restart-proof reminder loop (PLAN.md §6.4). Each tick:
 * 1. materializes template occurrences for the next 7 days and drops stale untouched ones,
 * 2. ensures one reminder row per (occurrence, offset),
 * 3. sends due reminders (claim first, release on failure) or skips the ones too late,
 * 4. refreshes the #agenda message when its content changed.
 */
export class ReminderScheduler {
  private readonly now: () => Date;
  private agendaChecked = false;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<TickReport> | undefined;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
  }

  start(intervalMs = 30_000): void {
    const run = () => {
      this.tick().catch((error: unknown) =>
        this.deps.logger.error({ err: error }, 'reminder tick failed'),
      );
    };
    run();
    this.timer = setInterval(run, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs one tick; overlapping calls share the tick in progress. */
  tick(): Promise<TickReport> {
    this.running ??= this.runTick().finally(() => (this.running = undefined));
    return this.running;
  }

  /** How an occurrence should look right now, or null if its template is gone or disabled. */
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

  /** Records a vote and refreshes every posted reminder of that occurrence. */
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
    const { store, config, logger } = this.deps;
    const timeZone = config().settings.timezone;
    const until = new Date(now.getTime() + WINDOW_MS);

    // 1. Template occurrences.
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

    // 2. Reminder rows.
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

    // 3. Due reminders.
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

    // 4. Agenda.
    const items = store
      .occurrencesBetween(now, until)
      .map((o) => this.view(o))
      .filter((v): v is OccurrenceView => v !== null && !v.cancelled);
    report.agendaUpdated = await this.refreshAgenda(items);
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
    // Always rewrite once after startup, in case the message was deleted while the bot was off.
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
