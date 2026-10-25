import { randomUUID } from 'node:crypto';

const DEFAULT_TTL_MS = 60_000;

/**
 * Short-lived, one-shot store for actions awaiting a "Confirmar" click. Only the user who
 * triggered the action can take it, and it expires after the TTL. In-memory on purpose: a
 * pending confirmation is not worth surviving a restart.
 */
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

  /** Returns the payload once; undefined if unknown, expired, or owned by someone else. */
  take(id: string, userId: string): T | undefined {
    const entry = this.entries.get(id);
    if (!entry || entry.userId !== userId) return undefined;

    this.entries.delete(id);
    return entry.expiresAt > this.now() ? entry.payload : undefined;
  }

  /** Drops the entry without running it (the "Cancelar" button). */
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
