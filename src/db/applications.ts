import { and, desc, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { applications } from './schema.js';

export type Application = typeof applications.$inferSelect;
export type NewApplication = Omit<
  typeof applications.$inferInsert,
  'id' | 'status' | 'messageId' | 'decidedBy' | 'decidedAt' | 'createdAt'
>;

export class ApplicationStore {
  constructor(private readonly db: Db) {}

  create(application: NewApplication): Application {
    return this.db.insert(applications).values(application).returning().get();
  }

  get(id: number): Application | undefined {
    return this.db.select().from(applications).where(eq(applications.id, id)).get();
  }

  /** The member's application still waiting for a decision, if any. */
  pendingFor(userId: string): Application | undefined {
    return this.db
      .select()
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.status, 'pending')))
      .orderBy(desc(applications.createdAt))
      .get();
  }

  /** Newest first; every status when none is given. */
  list(status?: Application['status'], limit = 50): Application[] {
    return this.db
      .select()
      .from(applications)
      .where(status ? eq(applications.status, status) : undefined)
      .orderBy(desc(applications.createdAt))
      .limit(limit)
      .all();
  }

  setMessage(id: number, messageId: string, threadId: string | null): void {
    this.db.update(applications).set({ messageId, threadId }).where(eq(applications.id, id)).run();
  }

  decide(id: number, status: 'approved' | 'rejected', decidedBy: string): void {
    this.db
      .update(applications)
      .set({ status, decidedBy, decidedAt: new Date() })
      .where(eq(applications.id, id))
      .run();
  }
}
