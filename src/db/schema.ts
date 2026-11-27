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

// Steam announcements already posted in #noticias (messageId null = skipped on first run).
export const postedNews = sqliteTable('posted_news', {
  id: text('id').primaryKey(),
  messageId: text('message_id'),
  postedAt: integer('posted_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
});

// Recruitment applications (the #recrutamento form), reviewed by the officers there.
export const APPLICATION_KINDS = ['member', 'ally', 'partner', 'restricted'] as const;

export const applications = sqliteTable('applications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  /** The character, read from the official site; all null for a Parceiro who left it out. */
  characterId: text('character_id'),
  characterName: text('character_name'),
  serverId: integer('server_id'),
  className: text('class_name'),
  level: integer('level'),
  legion: text('legion').notNull().default(''),
  combatPower: integer('combat_power'),
  itemLevel: integer('item_level'),
  /** What approving does: Membro (Soldado), Aliança, Parceiro, or Restrito (daily check only). */
  kind: text('kind', { enum: APPLICATION_KINDS }).notNull().default('member'),
  /** What the applicant picked in the form; officers may change `kind` with Mudar. */
  requestedKind: text('requested_kind', { enum: APPLICATION_KINDS }).notNull().default('member'),
  /** `form`: sent with "Enviar minha ficha". `check`: opened by the daily check for a review. */
  origin: text('origin', { enum: ['form', 'check'] })
    .notNull()
    .default('form'),
  /** For an Aliança: the legion, as the official site showed it. */
  allianceLegion: text('alliance_legion'),
  /** "Quem te convidou / por que quer entrar", from the form. */
  note: text('note'),
  /** Someone else already had this character registered when it was sent. */
  duplicateOf: text('duplicate_of'),
  /** Daily check: the standing before the bot changed it (Recusar puts it back). */
  previousStanding: text('previous_standing'),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] })
    .notNull()
    .default('pending'),
  messageId: text('message_id'),
  /** The private thread in the review channel that holds the card (null for older cards). */
  threadId: text('thread_id'),
  decidedBy: text('decided_by'),
  decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
});

/**
 * Members holding Restrito, and why: the daily check (they left the legion; it lifts the role
 * when they come back), an officer (/member restrict: only an officer lifts it), or a character
 * that moved to another account.
 */
export const restrictions = sqliteTable('restrictions', {
  userId: text('user_id').primaryKey(),
  origin: text('origin', { enum: ['check', 'manual', 'transfer'] }).notNull(),
  reason: text('reason'),
  by: text('by').notNull(),
  at: integer('at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
});

// Party finder (/party): a card with join buttons, and who joined it.
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

// The in-game character of each member, registered when their application is approved.
export const registeredCharacters = sqliteTable('registered_characters', {
  userId: text('user_id').primaryKey(),
  characterId: text('character_id').notNull(),
  name: text('name').notNull(),
  serverId: integer('server_id').notNull(),
  classKey: text('class_key').notNull(),
  /** What the official site showed at the last registration or daily check. */
  legion: text('legion').notNull().default(''),
  combatPower: integer('combat_power'),
  itemLevel: integer('item_level'),
  checkedAt: integer('checked_at', { mode: 'timestamp_ms' }),
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
