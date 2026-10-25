import { and, asc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { eventOccurrences, events, reminders, rsvps } from './schema.js';

export type EventRow = typeof events.$inferSelect;
export type OccurrenceRow = typeof eventOccurrences.$inferSelect;
export type ReminderRow = typeof reminders.$inferSelect;
export type RsvpStatus = (typeof rsvps.$inferSelect)['status'];

/** Storage for one-off events, occurrences, reminders and RSVPs (PLAN.md §6.4, §6.5). */
export class EventStore {
  constructor(private readonly db: Db) {}

  // ---- One-off events --------------------------------------------------------------------------

  createEvent(event: Omit<typeof events.$inferInsert, 'id' | 'createdAt'>): {
    event: EventRow;
    occurrence: OccurrenceRow;
  } {
    return this.db.transaction((tx) => {
      const row = tx.insert(events).values(event).returning().get();
      const occurrence = tx
        .insert(eventOccurrences)
        .values({ eventId: row.id, startsAt: row.startsAt })
        .returning()
        .get();
      return { event: row, occurrence };
    });
  }

  getEvent(id: number): EventRow | undefined {
    return this.db.select().from(events).where(eq(events.id, id)).get();
  }

  /** Edits an event; a new start time also moves its occurrence and re-plans its reminders. */
  updateEvent(id: number, patch: Partial<Omit<EventRow, 'id' | 'createdAt' | 'createdBy'>>): void {
    this.db.transaction((tx) => {
      tx.update(events).set(patch).where(eq(events.id, id)).run();
      if (patch.startsAt) {
        const occurrence = tx
          .select()
          .from(eventOccurrences)
          .where(eq(eventOccurrences.eventId, id))
          .get();
        if (occurrence) {
          tx.update(eventOccurrences)
            .set({ startsAt: patch.startsAt })
            .where(eq(eventOccurrences.id, occurrence.id))
            .run();
          tx.delete(reminders)
            .where(and(eq(reminders.occurrenceId, occurrence.id), isNull(reminders.sentAt)))
            .run();
        }
      }
    });
  }

  // ---- Occurrences -----------------------------------------------------------------------------

  getOccurrence(id: number): OccurrenceRow | undefined {
    return this.db.select().from(eventOccurrences).where(eq(eventOccurrences.id, id)).get();
  }

  occurrenceForEvent(eventId: number): OccurrenceRow | undefined {
    return this.db
      .select()
      .from(eventOccurrences)
      .where(eq(eventOccurrences.eventId, eventId))
      .get();
  }

  /** Inserts the template occurrence unless it already exists (idempotent). */
  ensureTemplateOccurrence(templateKey: string, startsAt: Date): void {
    this.db.insert(eventOccurrences).values({ templateKey, startsAt }).onConflictDoNothing().run();
  }

  /**
   * Future occurrences of templates that haven't sent any reminder yet. These are safe to drop
   * and regenerate when a template changes or is disabled.
   */
  untouchedTemplateOccurrences(after: Date): OccurrenceRow[] {
    return this.db
      .select()
      .from(eventOccurrences)
      .where(
        and(
          isNotNull(eventOccurrences.templateKey),
          gte(eventOccurrences.startsAt, after),
          sql`not exists (select 1 from ${reminders} where ${reminders.occurrenceId} = ${eventOccurrences.id} and ${reminders.sentAt} is not null)`,
        ),
      )
      .all();
  }

  deleteOccurrence(id: number): void {
    this.db.delete(eventOccurrences).where(eq(eventOccurrences.id, id)).run();
  }

  /** Occurrences starting within [from, to], cancelled ones included, earliest first. */
  occurrencesBetween(from: Date, to: Date): OccurrenceRow[] {
    return this.db
      .select()
      .from(eventOccurrences)
      .where(and(gte(eventOccurrences.startsAt, from), lte(eventOccurrences.startsAt, to)))
      .orderBy(asc(eventOccurrences.startsAt))
      .all();
  }

  cancelOccurrence(id: number, at: Date): void {
    this.db
      .update(eventOccurrences)
      .set({ cancelledAt: at })
      .where(eq(eventOccurrences.id, id))
      .run();
  }

  // ---- Reminders -------------------------------------------------------------------------------

  ensureReminder(occurrenceId: number, offsetMinutes: number, dueAt: Date): void {
    this.db
      .insert(reminders)
      .values({ occurrenceId, offsetMinutes, dueAt })
      .onConflictDoNothing()
      .run();
  }

  /** Reminders that are due and neither sent nor skipped. */
  dueReminders(now: Date): ReminderRow[] {
    return this.db
      .select()
      .from(reminders)
      .where(and(lte(reminders.dueAt, now), isNull(reminders.sentAt), isNull(reminders.skippedAt)))
      .orderBy(asc(reminders.dueAt))
      .all();
  }

  /**
   * Marks the reminder as sent before posting it, so a second tick (or a restart) can't post it
   * twice. Returns false if someone already claimed it.
   */
  claimReminder(id: number, at: Date): boolean {
    const result = this.db
      .update(reminders)
      .set({ sentAt: at })
      .where(and(eq(reminders.id, id), isNull(reminders.sentAt)))
      .run();
    return result.changes === 1;
  }

  /** Undoes a claim when posting failed, so the next tick retries within the tolerance. */
  releaseReminder(id: number): void {
    this.db.update(reminders).set({ sentAt: null }).where(eq(reminders.id, id)).run();
  }

  skipReminder(id: number, at: Date): void {
    this.db.update(reminders).set({ skippedAt: at }).where(eq(reminders.id, id)).run();
  }

  setReminderMessage(id: number, messageId: string): void {
    this.db.update(reminders).set({ messageId }).where(eq(reminders.id, id)).run();
  }

  /** Posted reminder messages of an occurrence (to refresh their RSVP counts). */
  postedReminders(occurrenceId: number): ReminderRow[] {
    return this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.occurrenceId, occurrenceId), isNotNull(reminders.messageId)))
      .all();
  }

  // ---- RSVPs -----------------------------------------------------------------------------------

  setRsvp(occurrenceId: number, userId: string, status: RsvpStatus, at: Date): void {
    this.db
      .insert(rsvps)
      .values({ occurrenceId, userId, status, updatedAt: at })
      .onConflictDoUpdate({
        target: [rsvps.occurrenceId, rsvps.userId],
        set: { status, updatedAt: at },
      })
      .run();
  }

  rsvpsFor(occurrenceId: number): { userId: string; status: RsvpStatus }[] {
    return this.db
      .select({ userId: rsvps.userId, status: rsvps.status })
      .from(rsvps)
      .where(eq(rsvps.occurrenceId, occurrenceId))
      .orderBy(asc(rsvps.updatedAt))
      .all();
  }
}
