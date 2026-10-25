import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { managedObjects } from './schema.js';

export type ManagedKind = (typeof managedObjects.$inferSelect)['kind'];

export interface ManagedEntry {
  discordId: string;
  fingerprint: string | null;
}

/** key → entry for one kind. */
export type ManagedMap = Map<string, ManagedEntry>;

export interface ManagedState {
  role: ManagedMap;
  category: ManagedMap;
  channel: ManagedMap;
  message: ManagedMap;
}

export class ManagedObjectStore {
  constructor(private readonly db: Db) {}

  all(): ManagedState {
    const state: ManagedState = {
      role: new Map(),
      category: new Map(),
      channel: new Map(),
      message: new Map(),
    };
    for (const row of this.db.select().from(managedObjects).all()) {
      state[row.kind].set(row.key, { discordId: row.discordId, fingerprint: row.fingerprint });
    }
    return state;
  }

  get(kind: ManagedKind, key: string): ManagedEntry | undefined {
    const row = this.db
      .select()
      .from(managedObjects)
      .where(and(eq(managedObjects.kind, kind), eq(managedObjects.key, key)))
      .get();
    return row && { discordId: row.discordId, fingerprint: row.fingerprint };
  }

  set(kind: ManagedKind, key: string, discordId: string, fingerprint: string | null = null): void {
    this.db
      .insert(managedObjects)
      .values({ kind, key, discordId, fingerprint })
      .onConflictDoUpdate({
        target: [managedObjects.kind, managedObjects.key],
        set: { discordId, fingerprint, updatedAt: new Date() },
      })
      .run();
  }

  delete(kind: ManagedKind, key: string): void {
    this.db
      .delete(managedObjects)
      .where(and(eq(managedObjects.kind, kind), eq(managedObjects.key, key)))
      .run();
  }
}
