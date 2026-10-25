import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { fieldBossSourceHealth, fieldBossTimers } from './schema.js';

export type BossTimer = typeof fieldBossTimers.$inferSelect;
export type SourceHealth = typeof fieldBossSourceHealth.$inferSelect;

export class FieldBossStore {
  constructor(private readonly db: Db) {}

  all(): BossTimer[] {
    return this.db.select().from(fieldBossTimers).all();
  }

  get(bossKey: string): BossTimer | undefined {
    return this.db.select().from(fieldBossTimers).where(eq(fieldBossTimers.bossKey, bossKey)).get();
  }

  upsert(timer: BossTimer): void {
    const { bossKey, ...rest } = timer;
    this.db
      .insert(fieldBossTimers)
      .values(timer)
      .onConflictDoUpdate({ target: fieldBossTimers.bossKey, set: rest })
      .run();
  }

  delete(bossKey: string): void {
    this.db.delete(fieldBossTimers).where(eq(fieldBossTimers.bossKey, bossKey)).run();
  }

  health(provider: string): SourceHealth {
    return (
      this.db
        .select()
        .from(fieldBossSourceHealth)
        .where(eq(fieldBossSourceHealth.provider, provider))
        .get() ?? {
        provider,
        lastOkAt: null,
        lastErrorAt: null,
        lastError: null,
        lastWarnedAt: null,
      }
    );
  }

  saveHealth(health: SourceHealth): void {
    const { provider, ...rest } = health;
    this.db
      .insert(fieldBossSourceHealth)
      .values(health)
      .onConflictDoUpdate({ target: fieldBossSourceHealth.provider, set: rest })
      .run();
  }
}
