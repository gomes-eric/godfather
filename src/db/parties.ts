import { and, asc, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { parties, partyMembers } from './schema.js';

export type Party = typeof parties.$inferSelect;

/** Party finder groups and their members, oldest member first. */
export class PartyStore {
  constructor(private readonly db: Db) {}

  create(party: {
    channelId: string;
    ownerId: string;
    activity: string;
    slots: number;
    startsAt: string | null;
  }): Party {
    const created = this.db.insert(parties).values(party).returning().get();
    this.join(created.id, party.ownerId);
    return created;
  }

  get(id: number): Party | undefined {
    return this.db.select().from(parties).where(eq(parties.id, id)).get();
  }

  setMessage(id: number, messageId: string): void {
    this.db.update(parties).set({ messageId }).where(eq(parties.id, id)).run();
  }

  close(id: number): void {
    this.db.update(parties).set({ closed: true }).where(eq(parties.id, id)).run();
  }

  members(id: number): string[] {
    return this.db
      .select({ userId: partyMembers.userId })
      .from(partyMembers)
      .where(eq(partyMembers.partyId, id))
      .orderBy(asc(partyMembers.joinedAt))
      .all()
      .map((row) => row.userId);
  }

  join(id: number, userId: string): void {
    this.db.insert(partyMembers).values({ partyId: id, userId }).onConflictDoNothing().run();
  }

  leave(id: number, userId: string): void {
    this.db
      .delete(partyMembers)
      .where(and(eq(partyMembers.partyId, id), eq(partyMembers.userId, userId)))
      .run();
  }
}
