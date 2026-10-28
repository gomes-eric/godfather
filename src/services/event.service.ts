import { ConfigError } from '../config/loader.js';
import type { Weekday } from '../config/schema.js';
import type { ConfigStore, EventTemplatePatch } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { fold } from '../core/text.js';
import { parseWhen, unixSeconds as unix } from '../core/schedule.js';
import type { EventStore } from '../db/events.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { OccurrenceView, ReminderScheduler, RsvpSummary } from './reminder.scheduler.js';

const t = ptBR.events;

export interface NewEvent {
  title: string;
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

interface Deps {
  store: EventStore;
  scheduler: ReminderScheduler;
  config: ConfigStore;
  runAction: ActionRunner;
  now?: () => Date;
}

/** One-off events, cancellations, RSVP lists and recurring templates (PLAN.md §6.4, §6.5). */
export class EventService {
  private readonly now: () => Date;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
  }

  private timeZone() {
    return this.deps.config.get().settings.timezone;
  }

  private findView(occurrenceId: number): OccurrenceView | null {
    const occurrence = this.deps.store.getOccurrence(occurrenceId);
    return occurrence ? this.deps.scheduler.view(occurrence) : null;
  }

  async create(actor: Actor, input: NewEvent): Promise<ServiceOutcome<string>> {
    const startsAt = parseWhen(input.when, this.now(), this.timeZone());
    if (!startsAt) return rejected(t.badWhen);
    if (startsAt <= this.now()) return rejected(t.inPast);

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
        this.deps.scheduler.refreshSoon();
        return t.created(occurrence.id, input.title, unix(startsAt));
      },
    });
  }

  async edit(
    actor: Actor,
    occurrenceId: number,
    input: EventEdit,
  ): Promise<ServiceOutcome<string>> {
    const occurrence = this.deps.store.getOccurrence(occurrenceId);
    if (!occurrence) return rejected(t.notFound(occurrenceId));
    if (occurrence.eventId === null) return rejected(t.templateOnlyEdit);

    let startsAt: Date | undefined;
    if (input.when) {
      const parsed = parseWhen(input.when, this.now(), this.timeZone());
      if (!parsed) return rejected(t.badWhen);
      if (parsed <= this.now()) return rejected(t.inPast);
      startsAt = parsed;
    }

    const eventId = occurrence.eventId;
    return this.deps.runAction({
      actor,
      action: 'event.edit',
      target: `#${occurrenceId}`,
      params: { ...input, ...(startsAt && { startsAt: startsAt.toISOString() }) },
      preview: `#${occurrenceId}`,
      execute: async () => {
        this.deps.store.updateEvent(eventId, {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(startsAt && { startsAt }),
        });
        this.deps.scheduler.refreshSoon();
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
        this.deps.scheduler.refreshSoon();
        return t.cancelled(occurrenceId);
      },
    });
  }

  /** Upcoming occurrences (next 7 days), cancelled ones left out. */
  async list(actor: Actor): Promise<ServiceOutcome<OccurrenceView[]>> {
    return this.deps.runAction({
      actor,
      action: 'event.read',
      preview: 'event.read',
      execute: async () => this.deps.scheduler.upcoming(this.now()),
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
      execute: async () => ({ view, rsvp: this.deps.scheduler.rsvpSummary(occurrenceId) }),
    });
  }

  /** RSVP button click. */
  async vote(
    actor: Actor,
    occurrenceId: number,
    status: 'yes' | 'maybe' | 'no',
  ): Promise<ServiceOutcome<string>> {
    const view = this.findView(occurrenceId);
    if (!view || view.cancelled) return rejected(t.gone);
    return this.deps.runAction({
      actor,
      action: 'event.rsvp',
      preview: 'event.rsvp',
      execute: async () => {
        await this.deps.scheduler.vote(occurrenceId, actor.userId, status);
        return t.voted(t.statusName[status], view.title);
      },
    });
  }

  async updateTemplate(
    actor: Actor,
    key: string,
    patch: EventTemplatePatch,
  ): Promise<ServiceOutcome<string>> {
    if (!this.deps.config.get().eventTemplates.some((tpl) => tpl.key === key)) {
      return rejected(t.templateUnknown(key));
    }
    try {
      return await this.deps.runAction({
        actor,
        action: 'event.template.edit',
        target: key,
        params: patch,
        preview: key,
        execute: async () => {
          this.deps.config.updateEventTemplate(key, patch);
          this.deps.scheduler.refreshSoon();
          return t.templateUpdated(key);
        },
      });
    } catch (error) {
      if (error instanceof ConfigError) return rejected(t.templateInvalid(error.message));
      throw error;
    }
  }
}

/** "mon,thu,sat" / "seg qui sáb" / "daily" → template days. */
export function parseDays(input: string): (Weekday | 'daily')[] | null {
  const aliases: Record<string, Weekday | 'daily'> = {
    daily: 'daily',
    'todo dia': 'daily',
    todos: 'daily',
    sun: 'sun',
    dom: 'sun',
    mon: 'mon',
    seg: 'mon',
    tue: 'tue',
    ter: 'tue',
    wed: 'wed',
    qua: 'wed',
    thu: 'thu',
    qui: 'thu',
    fri: 'fri',
    sex: 'fri',
    sat: 'sat',
    sab: 'sat',
  };
  const normalized = fold(input);
  if (aliases[normalized] === 'daily') return ['daily'];
  const days = normalized
    .split(/[\s,;/]+/)
    .filter(Boolean)
    .map((word) => aliases[word.slice(0, 3)]);
  if (days.length === 0 || days.some((d) => d === undefined || d === 'daily')) return null;
  return [...new Set(days as Weekday[])];
}
