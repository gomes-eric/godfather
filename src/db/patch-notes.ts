import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { postedPatchNotes } from './schema.js';

/** Which Steam patch-note posts were already posted (or skipped on the first run). */
export class PatchNoteStore {
  constructor(private readonly db: Db) {}

  isEmpty(): boolean {
    return this.db.select().from(postedPatchNotes).limit(1).all().length === 0;
  }

  has(id: string): boolean {
    return (
      this.db.select().from(postedPatchNotes).where(eq(postedPatchNotes.id, id)).get() !== undefined
    );
  }

  /** `messageId` is null for notes that were seen but deliberately not posted. */
  add(id: string, messageId: string | null): void {
    this.db.insert(postedPatchNotes).values({ id, messageId }).onConflictDoNothing().run();
  }
}
