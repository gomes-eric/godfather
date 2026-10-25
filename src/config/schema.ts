import { PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';
import { TIERS, type RankedTier } from '../core/tiers.js';

// Schema of server.yaml (PLAN.md §6.1, docs/SERVER_LAYOUT.md). Sections that later phases
// own (eventTemplates, fieldBosses) stay loose until those phases define them.

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
const key = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'keys are lowercase-kebab-case');

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
  archetype: z.enum(['warrior', 'scout', 'mage', 'priest']).optional(),
  emoji: z.string().optional(),
  managed: z.boolean().default(true),
});

const accessSchema = z.object({ view: accessLevel, write: accessLevel });

const forumTagSchema = z.object({ name: z.string().min(1).max(20), emoji: z.string().optional() });

export const CHANNEL_TYPES = ['text', 'announcement', 'voice', 'forum'] as const;
export type ChannelKind = (typeof CHANNEL_TYPES)[number];

const channelSchema = z.object({
  key,
  type: z.enum(CHANNEL_TYPES),
  name: z.string().min(1).max(100),
  topic: z.string().max(1024).optional(),
  access: accessSchema.partial().optional(),
  allowSlashCommands: accessLevel.optional(),
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

const voiceAccessSchema = z.object({
  role: key,
  allow: z.array(permissionName).min(1),
  scope: z.literal('all-voice'),
});

const AFK_TIMEOUTS = [60, 300, 900, 1800, 3600] as const;

const settingsSchema = z.looseObject({
  botName: z.string().min(1),
  locale: z.string().default('pt-BR'),
  timezone: z.string().min(1),
  community: z.object({ enable: z.boolean(), rulesChannel: key, updatesChannel: key }),
  afk: z.object({
    channel: key,
    timeoutSeconds: z.number().refine((v) => (AFK_TIMEOUTS as readonly number[]).includes(v), {
      message: `timeoutSeconds must be one of ${AFK_TIMEOUTS.join(', ')}`,
    }),
  }),
  welcome: z.object({ channel: key, autoRole: key, message: z.string().min(1) }),
  rules: z.object({ channel: key, message: z.string().min(1).max(4000) }),
  rolePicker: z.object({ channel: key, multipleClasses: z.boolean().default(false) }),
  audit: z.object({ channel: key }),
  musicGuard: z.object({ channel: key }),
});

export const serverConfigSchema = z
  .looseObject({
    settings: settingsSchema,
    roles: z.array(roleSchema).min(1),
    categories: z.array(categorySchema).min(1),
    voiceAccess: z.array(voiceAccessSchema).default([]),
    voiceGenerators: z.array(voiceGeneratorSchema).default([]),
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
    const settingChannels: [string[], string, Set<string>][] = [
      [
        ['settings', 'community', 'rulesChannel'],
        config.settings.community.rulesChannel,
        textChannelKeys,
      ],
      [
        ['settings', 'community', 'updatesChannel'],
        config.settings.community.updatesChannel,
        textChannelKeys,
      ],
      [['settings', 'welcome', 'channel'], config.settings.welcome.channel, textChannelKeys],
      [['settings', 'rules', 'channel'], config.settings.rules.channel, textChannelKeys],
      [['settings', 'rolePicker', 'channel'], config.settings.rolePicker.channel, textChannelKeys],
      [['settings', 'audit', 'channel'], config.settings.audit.channel, textChannelKeys],
      [['settings', 'musicGuard', 'channel'], config.settings.musicGuard.channel, textChannelKeys],
      [
        ['settings', 'afk', 'channel'],
        config.settings.afk.channel,
        new Set(channels.filter((c) => c.type === 'voice').map((c) => c.key)),
      ],
    ];
    for (const [path, value, allowed] of settingChannels) {
      if (!allowed.has(value)) issue(path, `"${value}" is not a channel key of the right type`);
    }

    if (!roleKeys.includes(config.settings.welcome.autoRole)) {
      issue(
        ['settings', 'welcome', 'autoRole'],
        `unknown role key "${config.settings.welcome.autoRole}"`,
      );
    }
    config.voiceAccess.forEach((entry, i) => {
      if (!roleKeys.includes(entry.role))
        issue(['voiceAccess', i, 'role'], `unknown role key "${entry.role}"`);
    });
    config.voiceGenerators.forEach((generator, i) => {
      if (!categoryKeys.includes(generator.category)) {
        issue(['voiceGenerators', i, 'category'], `unknown category key "${generator.category}"`);
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

/** Discord role names for each ranked tier, e.g. { officer: "Oficial" }. */
export function tierRoleNames(config: ServerConfig): Partial<Record<RankedTier, string>> {
  const names: Partial<Record<RankedTier, string>> = {};
  for (const role of config.roles) {
    if (role.tier && role.tier !== 'visitor') names[role.tier] = role.name;
  }
  return names;
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
