import { createHash } from 'node:crypto';
import { PermissionFlagsBits } from 'discord.js';
import {
  channelNameByKey,
  tierRoleKeys,
  type RoleConfig,
  type ServerConfig,
} from '../config/schema.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { DesiredChannel, DesiredPanel, DesiredState, PanelButton } from './model.js';
import { computeOverwrites } from './overwrites.js';

export const ROLE_PICKER_PREFIX = 'class:';
export const PANEL_PREFIX = 'panel-';
export const PANEL_KEYS = { rules: 'panel-rules', rolePicker: 'panel-role-picker' } as const;

const RULES_COLOR = 0xe0303a;
const ROLE_PICKER_COLOR = 0xa855f7;

function permissionBits(names: (keyof typeof PermissionFlagsBits)[]): bigint {
  return names.reduce((bits, name) => bits | PermissionFlagsBits[name], 0n);
}

const ARCHETYPE_ORDER = ['warrior', 'scout', 'mage', 'priest'] as const;
const ARCHETYPE_STYLE = {
  warrior: 'primary',
  scout: 'success',
  mage: 'danger',
  priest: 'secondary',
} as const satisfies Record<(typeof ARCHETYPE_ORDER)[number], PanelButton['style']>;

/** Intro plus one line per archetype ("🔵 Guerreiros · ⚔️ Gladiador · 🛡️ Templário"). */
function rolePickerDescription(classRoles: RoleConfig[], multipleClasses: boolean): string {
  const t = ptBR.panels;
  const lines = ARCHETYPE_ORDER.flatMap((archetype) => {
    const roles = classRoles.filter((r) => r.archetype === archetype);
    if (roles.length === 0) return [];
    const names = roles.map((r) => `${r.emoji ?? ''} ${r.name}`.trim()).join(' · ');
    return [`${t.archetypes[archetype]} · ${names}`];
  });
  const loose = classRoles.filter((r) => !r.archetype);
  if (loose.length > 0)
    lines.push(loose.map((r) => `${r.emoji ?? ''} ${r.name}`.trim()).join(' · '));
  return [t.rolePickerIntro(multipleClasses), '', ...lines, '', `-# ${t.rolePickerFooter}`].join(
    '\n',
  );
}

function panel(fields: Omit<DesiredPanel, 'fingerprint'>): DesiredPanel {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(fields))
    .digest('hex')
    .slice(0, 16);
  return { ...fields, fingerprint };
}

/** Everything /setup should make true in Discord, derived from server.yaml. */
export function buildDesiredState(config: ServerConfig): DesiredState {
  // Roles with Administrator bypass channel overwrites, so they get none. This also keeps
  // /setup from depending on the Comandante role, which sits above the bot's own role.
  const administrators = new Set(
    config.roles.filter((r) => r.permissions.includes('Administrator')).map((r) => r.key),
  );
  const tiers = Object.fromEntries(
    Object.entries(tierRoleKeys(config)).filter(([, key]) => !administrators.has(key)),
  );
  const voiceAllows = config.voiceAccess.map((entry) => ({
    roleKey: entry.role,
    allow: permissionBits(entry.allow),
  }));

  const roles = config.roles
    .filter((role) => role.managed)
    .map((role) => ({
      key: role.key,
      name: role.name,
      color: role.color ?? 0,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: permissionBits(role.permissions),
    }));

  const categories = config.categories
    .filter((category) => category.managed)
    .map((category) => {
      const hasVoice =
        category.channels.some((c) => c.type === 'voice' || c.type === 'stage') ||
        config.voiceGenerators.some((g) => g.category === category.key);
      return {
        key: category.key,
        name: category.name,
        overwrites: computeOverwrites({
          kind: 'category',
          view: category.access.view,
          write: category.access.write,
          tierRoleKeys: tiers,
          ...(hasVoice && { extraAllows: voiceAllows }),
        }),
      };
    });

  const channels: DesiredChannel[] = [];
  for (const category of config.categories) {
    for (const channel of category.channels.filter((c) => c.managed)) {
      const access = { ...category.access, ...channel.access };
      const isVoice = channel.type === 'voice' || channel.type === 'stage';
      channels.push({
        key: channel.key,
        categoryKey: category.key,
        kind: channel.type,
        name: channel.name,
        topic: isVoice ? null : (channel.topic ?? null),
        userLimit: isVoice ? (channel.userLimit ?? 0) : 0,
        overwrites: computeOverwrites({
          kind: channel.type,
          view: access.view,
          write: access.write,
          tierRoleKeys: tiers,
          ...(channel.allowSlashCommands && { slashCommands: channel.allowSlashCommands }),
          extraAllows: [
            ...(isVoice ? voiceAllows : []),
            ...channel.allow.map((extra) => ({
              roleKey: extra.role,
              allow: permissionBits(extra.permissions),
            })),
          ],
        }),
        tags:
          channel.type === 'forum'
            ? channel.tags.map((tag) => ({ name: tag.name, emoji: tag.emoji ?? null }))
            : [],
        requireTag: channel.type === 'forum' && channel.requireTag,
      });
    }

    // Join-to-create generators sit after the category's own channels.
    for (const generator of config.voiceGenerators.filter((g) => g.category === category.key)) {
      channels.push({
        key: generator.key,
        categoryKey: category.key,
        kind: 'voice',
        name: generator.name,
        topic: null,
        userLimit: 0,
        overwrites: computeOverwrites({
          kind: 'voice',
          view: category.access.view,
          write: category.access.write,
          tierRoleKeys: tiers,
          extraAllows: voiceAllows,
        }),
        tags: [],
        requireTag: false,
      });
    }
  }

  const classRoles = config.roles.filter((role) => role.class);
  const panels = [
    panel({
      key: PANEL_KEYS.rules,
      channelKey: config.settings.rules.channel,
      channelName: channelNameByKey(config, config.settings.rules.channel) ?? '',
      title: config.settings.rules.title ?? null,
      description: config.settings.rules.message.trim(),
      color: RULES_COLOR,
      buttons: [],
    }),
    panel({
      key: PANEL_KEYS.rolePicker,
      channelKey: config.settings.rolePicker.channel,
      channelName: channelNameByKey(config, config.settings.rolePicker.channel) ?? '',
      title: ptBR.panels.rolePickerTitle,
      description: rolePickerDescription(classRoles, config.settings.rolePicker.multipleClasses),
      color: ROLE_PICKER_COLOR,
      buttons: classRoles.map((role) => ({
        customId: `${ROLE_PICKER_PREFIX}${role.key}`,
        label: role.name,
        emoji: role.emoji ?? null,
        ...(role.archetype && {
          row: ARCHETYPE_ORDER.indexOf(role.archetype),
          style: ARCHETYPE_STYLE[role.archetype],
        }),
      })),
    }),
  ];

  return {
    roles,
    categories,
    channels,
    community: {
      enable: config.settings.community.enable,
      rulesChannelKey: config.settings.community.rulesChannel,
      updatesChannelKey: config.settings.community.updatesChannel,
    },
    afk: {
      channelKey: config.settings.afk.channel,
      channelName: channelNameByKey(config, config.settings.afk.channel) ?? '',
      timeoutSeconds: config.settings.afk.timeoutSeconds,
    },
    panels,
    unmanagedKeys: {
      role: new Set(config.roles.filter((r) => !r.managed).map((r) => r.key)),
      category: new Set(config.categories.filter((c) => !c.managed).map((c) => c.key)),
      channel: new Set(
        config.categories.flatMap((c) =>
          c.channels.filter((ch) => !ch.managed).map((ch) => ch.key),
        ),
      ),
    },
  };
}
