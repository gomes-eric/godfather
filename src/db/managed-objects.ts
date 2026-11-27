import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { managedObjects } from './schema.js';

export type ManagedKind = (typeof managedObjects.$inferSelect)['kind'];

export interface ManagedEntry {
  discordId: string;
  fingerprint: string | null;
}

export type ManagedMap = Map<string, ManagedEntry>;

export interface ManagedState {
  role: ManagedMap;
  category: ManagedMap;
  channel: ManagedMap;
  message: ManagedMap;
}

export class ManagedObjectStore {
  private cache: ManagedState | undefined;

  constructor(private readonly db: Db) {}

  private state(): ManagedState {
    if (!this.cache) {
      this.cache = { role: new Map(), category: new Map(), channel: new Map(), message: new Map() };
      for (const row of this.db.select().from(managedObjects).all()) {
        this.cache[row.kind].set(row.key, {
          discordId: row.discordId,
          fingerprint: row.fingerprint,
        });
      }
    }
    return this.cache;
  }

  all(): ManagedState {
    const { role, category, channel, message } = this.state();
    return {
      role: new Map(role),
      category: new Map(category),
      channel: new Map(channel),
      message: new Map(message),
    };
  }

  get(kind: ManagedKind, key: string): ManagedEntry | undefined {
    return this.state()[kind].get(key);
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
    this.state()[kind].set(key, { discordId, fingerprint });
  }

  delete(kind: ManagedKind, key: string): void {
    this.db
      .delete(managedObjects)
      .where(and(eq(managedObjects.kind, kind), eq(managedObjects.key, key)))
      .run();
    this.state()[kind].delete(key);
  }
}
