import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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
    locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    /** The control panel posted in the room's chat, edited when the room changes. */
    panelMessageId: text('panel_message_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => [index('temp_voice_generator_idx').on(table.generatorKey)],
);

// One-off events created with /event create (PLAN.md §6.4). Recurring ones live in server.yaml.
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  emoji: text('emoji').notNull(),
  description: text('description'),
  startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
  voiceChannelId: text('voice_channel_id'),
  ping: integer('ping', { mode: 'boolean' }).notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
});

// A concrete start of an event: one per one-off event, one per date for each template.
export const eventOccurrences = sqliteTable(
  'event_occurrences',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    templateKey: text('template_key'),
    eventId: integer('event_id').references(() => events.id, { onDelete: 'cascade' }),
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('occurrence_template_start_idx').on(table.templateKey, table.startsAt),
    uniqueIndex('occurrence_event_idx').on(table.eventId),
    index('occurrence_start_idx').on(table.startsAt),
  ],
);

// Reminder messages; the unique (occurrence, offset) pair makes sending idempotent.
export const reminders = sqliteTable(
  'reminders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    occurrenceId: integer('occurrence_id')
      .notNull()
      .references(() => eventOccurrences.id, { onDelete: 'cascade' }),
    offsetMinutes: integer('offset_minutes').notNull(),
    dueAt: integer('due_at', { mode: 'timestamp_ms' }).notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    skippedAt: integer('skipped_at', { mode: 'timestamp_ms' }),
    messageId: text('message_id'),
  },
  (table) => [
    uniqueIndex('reminder_occurrence_offset_idx').on(table.occurrenceId, table.offsetMinutes),
    index('reminder_due_idx').on(table.dueAt),
  ],
);

export const rsvps = sqliteTable(
  'rsvps',
  {
    occurrenceId: integer('occurrence_id')
      .notNull()
      .references(() => eventOccurrences.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    status: text('status', { enum: ['yes', 'maybe', 'no'] }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.occurrenceId, table.userId] })],
);

// Latest known state of each respawn-based field boss (PLAN.md §6.11). A manual entry wins over
// the questlog.gg feed until its respawn time passes.
export const fieldBossTimers = sqliteTable('field_boss_timers', {
  bossKey: text('boss_key').primaryKey(),
  alive: integer('alive', { mode: 'boolean' }).notNull(),
  respawnAt: integer('respawn_at', { mode: 'timestamp_ms' }),
  seenAt: integer('seen_at', { mode: 'timestamp_ms' }).notNull(),
  source: text('source', { enum: ['questlog', 'manual'] }).notNull(),
  overrideBy: text('override_by'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const fieldBossSourceHealth = sqliteTable('field_boss_source_health', {
  provider: text('provider').primaryKey(),
  lastOkAt: integer('last_ok_at', { mode: 'timestamp_ms' }),
  lastErrorAt: integer('last_error_at', { mode: 'timestamp_ms' }),
  lastError: text('last_error'),
  lastWarnedAt: integer('last_warned_at', { mode: 'timestamp_ms' }),
});

// Personal MCP tokens (PLAN.md §8.1). Only a SHA-256 hash is stored; the token carries no
// permissions of its own — each call uses its owner's current Discord roles.
export const mcpTokens = sqliteTable('mcp_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
});

// Steam patch-note posts already posted in #patch-notes (messageId null = skipped on first run).
export const postedPatchNotes = sqliteTable('posted_patch_notes', {
  id: text('id').primaryKey(),
  messageId: text('message_id'),
  postedAt: integer('posted_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
});

// The in-game character each member registered in #registro (one per member).
export const registeredCharacters = sqliteTable('registered_characters', {
  userId: text('user_id').primaryKey(),
  characterId: text('character_id').notNull(),
  name: text('name').notNull(),
  serverId: integer('server_id').notNull(),
  classKey: text('class_key').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
});

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
