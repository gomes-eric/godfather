import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { restrictions } from './schema.js';

export type Restriction = typeof restrictions.$inferSelect;
export type RestrictionOrigin = Restriction['origin'];

export class RestrictionStore {
  constructor(private readonly db: Db) {}

  get(userId: string): Restriction | undefined {
    return this.db.select().from(restrictions).where(eq(restrictions.userId, userId)).get();
  }

  set(entry: {
    userId: string;
    origin: RestrictionOrigin;
    reason: string | null;
    by: string;
  }): void {
    const row = { ...entry, at: new Date() };
    this.db
      .insert(restrictions)
      .values(row)
      .onConflictDoUpdate({ target: restrictions.userId, set: row })
      .run();
  }

  delete(userId: string): void {
    this.db.delete(restrictions).where(eq(restrictions.userId, userId)).run();
  }
}
