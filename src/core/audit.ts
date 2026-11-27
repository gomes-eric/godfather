import { desc } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { auditLog } from '../db/schema.js';
import type { Logger } from '../logger.js';
import type { Actor } from './actor.js';

export type AuditResult = 'ok' | 'denied' | 'rejected' | 'error' | 'confirmation_required';

export interface AuditEntry {
  actor: Actor;
  action: string;
  target?: string;
  params?: Record<string, unknown>;
  result: AuditResult;
}

export interface RecordedAuditEntry extends AuditEntry {
  id: number;
  at: Date;
}

export interface AuditPublisher {
  publish(entry: RecordedAuditEntry): Promise<void>;
}

const SECRET_KEY = /token|secret|password|authorization/i;
const MAX_PARAMS_LENGTH = 2000;

export function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      SECRET_KEY.test(key) ? '[redacted]' : value,
    ]),
  );
}

function serializeParams(params: Record<string, unknown> | undefined): string | null {
  if (!params || Object.keys(params).length === 0) return null;
  const json = JSON.stringify(params);
  return json.length > MAX_PARAMS_LENGTH ? `${json.slice(0, MAX_PARAMS_LENGTH)}…` : json;
}

export class AuditLog {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    private publisher?: AuditPublisher,
  ) {}

  setPublisher(publisher: AuditPublisher): void {
    this.publisher = publisher;
  }

  async record(entry: AuditEntry): Promise<RecordedAuditEntry> {
    const params = entry.params && sanitizeParams(entry.params);
    const paramsJson = serializeParams(params);
    const row = this.db
      .insert(auditLog)
      .values({
        actorId: entry.actor.userId,
        actorTier: entry.actor.source === 'system' ? 'system' : entry.actor.tier,
        source: entry.actor.source,
        harness: entry.actor.harness ?? null,
        action: entry.action,
        target: entry.target ?? null,
        paramsJson,
        result: entry.result,
      })
      .returning({ id: auditLog.id, at: auditLog.at })
      .get();

    const recorded: RecordedAuditEntry = {
      ...entry,
      ...(params && { params }),
      id: row.id,
      at: row.at,
    };

    try {
      await this.publisher?.publish(recorded);
    } catch (error) {
      this.logger.warn({ err: error, auditId: row.id }, 'failed to publish audit entry');
    }
    return recorded;
  }

  recent(limit: number): (typeof auditLog.$inferSelect)[] {
    return this.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(limit).all();
  }
}
