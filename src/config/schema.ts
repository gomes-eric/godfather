import { PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';
import { TIERS, type RankedTier } from '../core/tiers.js';

// Schema of server.yaml (PLAN.md §6.1, docs/SERVER_LAYOUT.md).

/** Minimum tier allowed to see or write, plus `bot` (only Padrinho) and `none` (nobody). */
export const ACCESS_LEVELS = [
  'everyone',
  'soldier',
  'officer',
  'commander',
  'bot',
  'none',
] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

const accessLevel = z.enum(ACCESS_LEVELS);
export const KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** 24h "HH:MM". */
export const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const key = z.string().regex(KEY_PATTERN, 'keys are lowercase-kebab-case');

const permissionName = z.custom<keyof typeof PermissionFlagsBits>(
  (value) => typeof value === 'string' && value in PermissionFlagsBits,
  { message: 'unknown Discord permission (see PermissionFlagsBits)' },
);

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'colors are #RRGGBB')
  .transform((value) => Number.parseInt(value.slice(1), 16));

const roleSchema = z.object({
  key,
  name: z.string().min(1).max(100),
  tier: z.enum(TIERS).optional(),
  color: hexColor.optional(),
  hoist: z.boolean().default(false),
  mentionable: z.boolean().default(false),
  permissions: z.array(permissionName).default([]),
  maxMembers: z.number().int().positive().optional(),
  class: z.boolean().default(false),
  emoji: z.string().optional(),
  managed: z.boolean().default(true),
});

const accessSchema = z.object({
  view: accessLevel,
  write: accessLevel,
  /**
   * Roles outside the tier ladder that get whatever Soldado gets here, e.g. Parceiro in the social
   * channels. A channel's own list replaces its category's; `[]` leaves them out.
   */
  asSoldier: z.array(key).optional(),
});

const forumTagSchema = z.object({ name: z.string().min(1).max(20), emoji: z.string().optional() });

export const CHANNEL_TYPES = ['text', 'announcement', 'voice', 'stage', 'forum'] as const;

/** Voice and stage channels: no topic, listed after text channels. */
export const isVoiceKind = (kind: string): boolean => kind === 'voice' || kind === 'stage';
export type ChannelKind = (typeof CHANNEL_TYPES)[number];

const channelSchema = z.object({
  key,
  type: z.enum(CHANNEL_TYPES),
  name: z.string().min(1).max(100),
  topic: z.string().max(1024).optional(),
  access: accessSchema.partial().optional(),
  allowSlashCommands: accessLevel.optional(),
  /** Fixed extra permissions for a role on this channel, e.g. music bots posting in #musica. */
  allow: z.array(z.object({ role: key, permissions: z.array(permissionName).min(1) })).default([]),
  /** Fixed denies for a role on this channel. */
  deny: z.array(z.object({ role: key, permissions: z.array(permissionName).min(1) })).default([]),
  userLimit: z.number().int().min(0).max(99).optional(),
  requireTag: z.boolean().default(false),
  tags: z.array(forumTagSchema).max(20).default([]),
  managed: z.boolean().default(true),
});

const categorySchema = z.object({
  key,
  name: z.string().min(1).max(100),
  access: accessSchema,
  channels: z.array(channelSchema).default([]),
  managed: z.boolean().default(true),
});

const voiceGeneratorSchema = z.object({
  key,
  category: key,
  name: z.string().min(1).max(100),
  nameTemplate: z.string().includes('{n}', { message: 'nameTemplate must contain {n}' }),
  userLimit: z.number().int().min(0).max(99),
});

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const reminderOffsets = z
  .array(
    z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
  )
  .min(1);
const clockTime = z.string().regex(CLOCK_PATTERN, 'time is HH:MM (24h)');

const eventTemplateSchema = z.object({
  key,
  title: z.string().min(1).max(100),
  emoji: z.string().default('📅'),
  description: z.string().max(1000).optional(),
  /** Weekdays, or ["daily"]. */
  days: z.array(z.enum([...WEEKDAYS, 'daily'])).min(1),
  time: clockTime,
  voiceChannel: key.optional(),
  ping: z.boolean().optional(),
  reminderOffsetsMinutes: reminderOffsets.optional(),
  enabled: z.boolean().default(true),
  /** Event id in shugo.gg's timers.json; its days and time then follow that file. */
  shugoEvent: z.string().min(1).optional(),
});

const voiceAccessSchema = z.object({
  role: key,
  allow: z.array(permissionName).min(1),
  scope: z.literal('all-voice'),
});

const AFK_TIMEOUTS = [60, 300, 900, 1800, 3600] as const;

const settingsSchema = z.looseObject({
  timezone: z.string().min(1),
  community: z.object({ enable: z.boolean(), rulesChannel: key, updatesChannel: key }),
  afk: z.object({
    channel: key,
    timeoutSeconds: z.number().refine((v) => (AFK_TIMEOUTS as readonly number[]).includes(v), {
      message: `timeoutSeconds must be one of ${AFK_TIMEOUTS.join(', ')}`,
    }),
  }),
  /** Role /member partner gives to people who don't play (they keep it instead of Visitante). */
  partnerRole: key.optional(),
  welcome: z.object({
    channel: key,
    autoRole: key,
    /** Role given to every bot that joins (Jockie, Rythm, ...) instead of autoRole. */
    botRole: key.optional(),
    title: z.string().max(256).optional(),
    message: z.string().min(1).max(4000),
    /** Shown as numbered fields under the message: what a newcomer should do first. */
    steps: z
      .array(z.object({ name: z.string().min(1).max(256), value: z.string().min(1).max(1024) }))
      .max(25)
      .default([]),
  }),
  rules: z.object({
    channel: key,
    title: z.string().max(256).optional(),
    message: z.string().min(1).max(4000),
  }),
  /**
   * Members can't change their own nickname (ChangeNickname is removed from @everyone); the
   * approved application and the daily check set it. Administrators are not affected.
   */
  lockNicknames: z.boolean().default(false),
  /** #noticias: every one of the game's Steam announcements, in Portuguese. */
  news: z
    .object({
      channel: key,
      steamAppId: z.number().int().positive(),
      pollMinutes: z.number().int().min(5).default(15),
      /** Claude summaries instead of the plain card (needs the federation ids in the env). */
      summary: z.object({ model: z.string().min(1).default('claude-haiku-5-5') }).optional(),
    })
    .optional(),
  /** Where the templates linked by `shugoEvent` take their days and time from in timers.json. */
  eventTimes: z
    .object({
      /** timers.json region; South America (Triniel) is global-sa, on São Paulo time. */
      region: z.string().min(1),
      /** Siege matching group, for events with one start time per group. */
      group: z.number().int().min(1).default(1),
      checkHours: z.number().int().min(1).default(6),
    })
    .optional(),
  /**
   * "Enviar minha ficha": applications go to reviewChannel with Aprovar/Recusar, and approved
   * members are welcomed in announceChannel (no DMs). pingRole is mentioned on each new one.
   */
  recruitment: z
    .object({
      /** Where /setup posts the "Enviar minha ficha" panel. */
      channel: key,
      reviewChannel: key,
      announceChannel: key,
      pingRole: key.optional(),
    })
    .optional(),
  /** Where recruitment, /perfil and the daily check look characters up on the official site. */
  characters: z.object({
    /** Search region: la = South America. */
    region: z.enum(['nae', 'naw', 'eu', 'la', 'as']),
    serverId: z.number().int().positive(),
    /** The server's name, shown on profile cards. */
    serverName: z.string().min(1).default('Triniel'),
    /** In-game legion name: the daily check reports who left or joined it. */
    legion: z.string().min(1),
    /** Daily check: officers get what changed (left the legion, new class…) here. */
    reportChannel: key.optional(),
    /** Board of registered legion members by combat power, rebuilt after each daily check. */
    rankingChannel: key.optional(),
  }),
  audit: z.object({ channel: key }),
  musicGuard: z.object({
    channel: key,
    /** Text commands people may type, e.g. Jockie Music's "m!". Matched case-insensitively. */
    commandPrefixes: z.array(z.string().min(1).max(10)).default([]),
  }),
  voiceRooms: z
    .object({
      /** New join-to-create rooms per minute for the whole server; 0 = no limit. */
      maxCreationsPerMinute: z.number().int().min(0).default(30),
    })
    .default({ maxCreationsPerMinute: 30 }),
  eventDefaults: z.object({
    announceChannel: key,
    agendaChannel: key,
    reminderOffsetsMinutes: reminderOffsets,
    /** `everyone` pings @everyone in reminders; `none` sends them silently. */
    ping: z.enum(['everyone', 'none']).default('everyone'),
  }),
});

export const serverConfigSchema = z
  .looseObject({
    settings: settingsSchema,
    roles: z.array(roleSchema).min(1),
    categories: z.array(categorySchema).min(1),
    voiceAccess: z.array(voiceAccessSchema).default([]),
    voiceGenerators: z.array(voiceGeneratorSchema).default([]),
    eventTemplates: z.array(eventTemplateSchema).default([]),
  })
  .superRefine((config, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    const duplicates = (keys: string[]) => keys.filter((k, i) => keys.indexOf(k) !== i);

    const roleKeys = config.roles.map((r) => r.key);
    for (const dup of duplicates(roleKeys)) issue(['roles'], `duplicate role key "${dup}"`);

    const categoryKeys = config.categories.map((c) => c.key);
    for (const dup of duplicates(categoryKeys)) {
      issue(['categories'], `duplicate category key "${dup}"`);
    }

    const channels = config.categories.flatMap((c) => c.channels);
    const channelKeys = [
      ...channels.map((c) => c.key),
      ...config.voiceGenerators.map((g) => g.key),
    ];
    for (const dup of duplicates(channelKeys))
      issue(['categories'], `duplicate channel key "${dup}"`);

    const textChannelKeys = new Set(
      channels.filter((c) => c.type === 'text' || c.type === 'announcement').map((c) => c.key),
    );
    const s = config.settings;
    // [path under settings, channel key or undefined when the feature is off]
    const textSettings: [string[], string | undefined][] = [
      [['community', 'rulesChannel'], s.community.rulesChannel],
      [['community', 'updatesChannel'], s.community.updatesChannel],
      [['welcome', 'channel'], s.welcome.channel],
      [['rules', 'channel'], s.rules.channel],
      [['audit', 'channel'], s.audit.channel],
      [['musicGuard', 'channel'], s.musicGuard.channel],
      [['news', 'channel'], s.news?.channel],
      [['recruitment', 'channel'], s.recruitment?.channel],
      [['recruitment', 'reviewChannel'], s.recruitment?.reviewChannel],
      [['recruitment', 'announceChannel'], s.recruitment?.announceChannel],
      [['characters', 'reportChannel'], s.characters.reportChannel],
      [['characters', 'rankingChannel'], s.characters.rankingChannel],
      [['eventDefaults', 'announceChannel'], s.eventDefaults.announceChannel],
      [['eventDefaults', 'agendaChannel'], s.eventDefaults.agendaChannel],
    ];
    for (const [path, value] of textSettings) {
      if (value !== undefined && !textChannelKeys.has(value)) {
        issue(['settings', ...path], `"${value}" is not a channel key of the right type`);
      }
    }
    if (!channels.some((c) => c.type === 'voice' && c.key === s.afk.channel)) {
      issue(['settings', 'afk', 'channel'], `"${s.afk.channel}" is not a voice channel key`);
    }

    if (!roleKeys.includes(config.settings.welcome.autoRole)) {
      issue(
        ['settings', 'welcome', 'autoRole'],
        `unknown role key "${config.settings.welcome.autoRole}"`,
      );
    }
    const partnerRole = config.settings.partnerRole;
    if (partnerRole !== undefined && !roleKeys.includes(partnerRole)) {
      issue(['settings', 'partnerRole'], `unknown role key "${partnerRole}"`);
    }
    const botRole = config.settings.welcome.botRole;
    if (botRole !== undefined && !roleKeys.includes(botRole)) {
      issue(['settings', 'welcome', 'botRole'], `unknown role key "${botRole}"`);
    }
    const checkAsSoldier = (path: string, list: string[] | undefined) => {
      for (const roleKey of list ?? []) {
        if (!roleKeys.includes(roleKey)) {
          issue(['categories'], `${path} asSoldier has unknown role key "${roleKey}"`);
        }
      }
    };
    for (const category of config.categories) {
      checkAsSoldier(`category "${category.key}"`, category.access.asSoldier);
      for (const channel of category.channels) {
        checkAsSoldier(`channel "${channel.key}"`, channel.access?.asSoldier);
      }
    }
    channels.forEach((channel) => {
      for (const extra of [...channel.allow, ...channel.deny]) {
        if (!roleKeys.includes(extra.role)) {
          issue(['categories'], `channel "${channel.key}" names unknown role key "${extra.role}"`);
        }
      }
    });
    config.voiceAccess.forEach((entry, i) => {
      if (!roleKeys.includes(entry.role))
        issue(['voiceAccess', i, 'role'], `unknown role key "${entry.role}"`);
    });
    config.voiceGenerators.forEach((generator, i) => {
      if (!categoryKeys.includes(generator.category)) {
        issue(['voiceGenerators', i, 'category'], `unknown category key "${generator.category}"`);
      }
    });

    const voiceChannelKeys = new Set(channels.filter((c) => isVoiceKind(c.type)).map((c) => c.key));
    const templateKeys = config.eventTemplates.map((t) => t.key);
    for (const dup of duplicates(templateKeys)) {
      issue(['eventTemplates'], `duplicate event template key "${dup}"`);
    }
    config.eventTemplates.forEach((template, i) => {
      if (template.voiceChannel && !voiceChannelKeys.has(template.voiceChannel)) {
        issue(
          ['eventTemplates', i, 'voiceChannel'],
          `"${template.voiceChannel}" is not a voice channel key`,
        );
      }
    });

    const seenTiers = new Set<string>();
    config.roles.forEach((role, i) => {
      if (!role.tier) return;
      if (seenTiers.has(role.tier))
        issue(['roles', i, 'tier'], `tier "${role.tier}" is assigned to more than one role`);
      seenTiers.add(role.tier);
    });
  });

export type ServerConfig = z.infer<typeof serverConfigSchema>;
export type RoleConfig = ServerConfig['roles'][number];
export type CategoryConfig = ServerConfig['categories'][number];
export type ChannelConfig = CategoryConfig['channels'][number];
export type EventTemplateConfig = ServerConfig['eventTemplates'][number];

/** The class roles (Gladiador, Clérigo...), in server.yaml order. */
export function classRoles(config: ServerConfig): RoleConfig[] {
  return config.roles.filter((role) => role.class);
}

/** Roles that stand in for Soldado somewhere (asSoldier), e.g. Parceiro. */
export function soldierLikeRoleKeys(config: ServerConfig): string[] {
  const keys = new Set<string>();
  for (const category of config.categories) {
    for (const key of category.access.asSoldier ?? []) keys.add(key);
    for (const channel of category.channels) {
      for (const key of channel.access?.asSoldier ?? []) keys.add(key);
    }
  }
  return [...keys];
}

/** Role keys for each ranked tier, e.g. { officer: "officer" }. */
export function tierRoleKeys(config: ServerConfig): Partial<Record<RankedTier, string>> {
  const keys: Partial<Record<RankedTier, string>> = {};
  for (const role of config.roles) {
    if (role.tier && role.tier !== 'visitor') keys[role.tier] = role.key;
  }
  return keys;
}

export function channelNameByKey(config: ServerConfig, channelKey: string): string | undefined {
  for (const category of config.categories) {
    const channel = category.channels.find((c) => c.key === channelKey);
    if (channel) return channel.name;
  }
  return config.voiceGenerators.find((g) => g.key === channelKey)?.name;
}
