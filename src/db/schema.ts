import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const managedObjects = sqliteTable(
  'managed_objects',
  {
    kind: text('kind', { enum: ['role', 'category', 'channel', 'message'] }).notNull(),
    key: text('key').notNull(),
    discordId: text('discord_id').notNull(),
    fingerprint: text('fingerprint'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => [primaryKey({ columns: [table.kind, table.key] })],
);

export const tempVoiceChannels = sqliteTable(
  'temp_voice_channels',
  {
    channelId: text('channel_id').primaryKey(),
    generatorKey: text('generator_key').notNull(),
    number: integer('number').notNull(),
    ownerId: text('owner_id').notNull(),
    locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    panelMessageId: text('panel_message_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => [index('temp_voice_generator_idx').on(table.generatorKey)],
);

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
    index('reminder_pending_due_idx')
      .on(table.dueAt)
      .where(sql`${table.sentAt} IS NULL AND ${table.skippedAt} IS NULL`),
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

export const postedNews = sqliteTable('posted_news', {
  id: text('id').primaryKey(),
  messageId: text('message_id'),
  postedAt: integer('posted_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
});

export const APPLICATION_KINDS = ['member', 'ally', 'partner', 'restricted'] as const;

export const applications = sqliteTable('applications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  characterId: text('character_id'),
  characterName: text('character_name'),
  serverId: integer('server_id'),
  className: text('class_name'),
  level: integer('level'),
  legion: text('legion').notNull().default(''),
  combatPower: integer('combat_power'),
  itemLevel: integer('item_level'),
  kind: text('kind', { enum: APPLICATION_KINDS }).notNull().default('member'),
  requestedKind: text('requested_kind', { enum: APPLICATION_KINDS }).notNull().default('member'),
  origin: text('origin', { enum: ['form', 'check'] })
    .notNull()
    .default('form'),
  allianceLegion: text('alliance_legion'),
  characterTakenBy: text('duplicate_of'),
  previousStanding: text('previous_standing'),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] })
    .notNull()
    .default('pending'),
  messageId: text('message_id'),
  threadId: text('thread_id'),
  decidedBy: text('decided_by'),
  decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
});

export const restrictions = sqliteTable('restrictions', {
  userId: text('user_id').primaryKey(),
  origin: text('origin', { enum: ['check', 'manual', 'transfer'] }).notNull(),
  reason: text('reason'),
  by: text('by').notNull(),
  at: integer('at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
});

export const parties = sqliteTable('parties', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channelId: text('channel_id').notNull(),
  ownerId: text('owner_id').notNull(),
  activity: text('activity').notNull(),
  slots: integer('slots').notNull(),
  startsAt: text('starts_at'),
  closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
});

export const partyMembers = sqliteTable(
  'party_members',
  {
    partyId: integer('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    joinedAt: integer('joined_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => [primaryKey({ columns: [table.partyId, table.userId] })],
);

export const registeredCharacters = sqliteTable('registered_characters', {
  userId: text('user_id').primaryKey(),
  characterId: text('character_id').notNull(),
  name: text('name').notNull(),
  serverId: integer('server_id').notNull(),
  classKey: text('class_key').notNull(),
  legion: text('legion').notNull().default(''),
  combatPower: integer('combat_power'),
  itemLevel: integer('item_level'),
  checkedAt: integer('checked_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
});

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
