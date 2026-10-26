import { createHash } from 'node:crypto';
import { PermissionFlagsBits } from 'discord.js';
import { channelNameByKey, tierRoleKeys, type ServerConfig } from '../config/schema.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { DesiredChannel, DesiredPanel, DesiredState } from './model.js';
import { computeOverwrites } from './overwrites.js';

/** The #recrutamento panel's "Quero entrar na legião" button; it opens the application form. */
export const RECRUIT_APPLY_ID = 'recruit:apply';
export const PANEL_PREFIX = 'panel-';
export const PANEL_KEYS = {
  rules: 'panel-rules',
  recruitment: 'panel-recruitment',
} as const;

const RULES_COLOR = 0xe0303a;
const RECRUITMENT_COLOR = 0x4fb286;

function permissionBits(names: (keyof typeof PermissionFlagsBits)[]): bigint {
  return names.reduce((bits, name) => bits | PermissionFlagsBits[name], 0n);
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
          asSoldierRoleKeys: category.access.asSoldier ?? [],
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
          asSoldierRoleKeys: access.asSoldier ?? [],
          ...(channel.allowSlashCommands && { slashCommands: channel.allowSlashCommands }),
          extraAllows: [
            ...(isVoice ? voiceAllows : []),
            ...channel.allow.map((extra) => ({
              roleKey: extra.role,
              allow: permissionBits(extra.permissions),
            })),
          ],
          extraDenies: channel.deny.map((extra) => ({
            roleKey: extra.role,
            deny: permissionBits(extra.permissions),
          })),
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
          asSoldierRoleKeys: category.access.asSoldier ?? [],
          extraAllows: voiceAllows,
        }),
        tags: [],
        requireTag: false,
      });
    }
  }

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
    ...(config.settings.recruitment
      ? [
          panel({
            key: PANEL_KEYS.recruitment,
            channelKey: config.settings.recruitment.channel,
            channelName: channelNameByKey(config, config.settings.recruitment.channel) ?? '',
            title: ptBR.panels.recruitmentTitle(config.settings.characters.legion),
            description: ptBR.panels.recruitmentIntro(config.settings.characters.legion),
            color: RECRUITMENT_COLOR,
            buttons: [
              {
                customId: RECRUIT_APPLY_ID,
                label: ptBR.recruitment.applyButton,
                emoji: '🤝',
                style: 'success',
              },
            ],
          }),
        ]
      : []),
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
    lockNicknames: config.settings.lockNicknames,
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
