import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Maps server.yaml keys to the Discord objects /setup created or adopted, so renaming an item
// in the yaml edits the same object instead of creating a new one (PLAN.md §6.1).
// Keys are only unique per kind: a category and a channel may both be called "music".
export const managedObjects = sqliteTable(
  'managed_objects',
  {
    kind: text('kind', { enum: ['role', 'category', 'channel', 'message'] }).notNull(),
    key: text('key').notNull(),
    discordId: text('discord_id').notNull(),
    /** For messages: hash of the rendered content, to know when the post needs an edit. */
    fingerprint: text('fingerprint'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => [primaryKey({ columns: [table.kind, table.key] })],
);

// Temporary voice rooms created by the join-to-create generators (PLAN.md §6.6). Persisted so a
// restart can clean up empty rooms and keep managing occupied ones.
export const tempVoiceChannels = sqliteTable(
  'temp_voice_channels',
  {
    channelId: text('channel_id').primaryKey(),
    generatorKey: text('generator_key').notNull(),
    number: integer('number').notNull(),
    ownerId: text('owner_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => [index('temp_voice_generator_idx').on(table.generatorKey)],
);

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
