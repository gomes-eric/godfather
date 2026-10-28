import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { postedNews } from './schema.js';

/** Which Steam announcements were already posted (or skipped on the first run). */
export class NewsStore {
  constructor(private readonly db: Db) {}

  isEmpty(): boolean {
    return this.db.select().from(postedNews).limit(1).all().length === 0;
  }

  has(id: string): boolean {
    return this.db.select().from(postedNews).where(eq(postedNews.id, id)).get() !== undefined;
  }

  /** `messageId` is null for posts that were seen but deliberately not posted. */
  add(id: string, messageId: string | null): void {
    this.db.insert(postedNews).values({ id, messageId }).onConflictDoNothing().run();
  }
}
