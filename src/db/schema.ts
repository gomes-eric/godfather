import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Every write action, from slash commands or MCP, is recorded here (PLAN.md §6.10).
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
    actorId: text('actor_id').notNull(),
    actorTier: text('actor_tier', {
      enum: ['commander', 'officer', 'soldier', 'visitor', 'system'],
    }).notNull(),
    source: text('source', { enum: ['slash', 'mcp', 'system'] }).notNull(),
    harness: text('harness'),
    action: text('action').notNull(),
    target: text('target'),
    paramsJson: text('params_json'),
    result: text('result', { enum: ['ok', 'denied', 'error', 'confirmation_required'] }).notNull(),
  },
  (table) => [index('audit_log_at_idx').on(table.at)],
);
