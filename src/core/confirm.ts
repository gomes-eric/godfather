import { randomUUID } from 'node:crypto';

const DEFAULT_TTL_MS = 60_000;

export class PendingConfirmations<T> {
  private readonly entries = new Map<string, { userId: string; payload: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  create(userId: string, payload: T): string {
    this.prune();
    const id = randomUUID();
    this.entries.set(id, { userId, payload, expiresAt: this.now() + this.ttlMs });
    return id;
  }

  take(id: string, userId: string): T | undefined {
    const entry = this.entries.get(id);
    if (!entry || entry.userId !== userId) return undefined;

    this.entries.delete(id);
    return entry.expiresAt > this.now() ? entry.payload : undefined;
  }

  cancel(id: string, userId: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.userId !== userId) return false;
    return this.entries.delete(id);
  }

  get size(): number {
    return this.entries.size;
  }

  private prune(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
  }
}
