import { createHash } from 'node:crypto';
import { PermissionFlagsBits } from 'discord.js';
import {
  channelNameByKey,
  isVoiceKind,
  tierRoleKeys,
  type ServerConfig,
} from '../config/schema.js';
import { COLORS } from '../discord/colors.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { DesiredChannel, DesiredPanel, DesiredState } from './model.js';
import { computeOverwrites } from './overwrites.js';

export const RECRUIT_APPLY_ID = 'recruit:apply';
export const PANEL_PREFIX = 'panel-';
export const PANEL_KEYS = {
  rules: 'panel-rules',
  recruitment: 'panel-recruitment',
} as const;

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

export function buildDesiredState(config: ServerConfig): DesiredState {
  // Roles with Administrator bypass channel overwrites, so they get none.
  const administrators = new Set(
    config.roles.filter((r) => r.permissions.includes('Administrator')).map((r) => r.key),
  );
  const tiers = Object.fromEntries(
    Object.entries(tierRoleKeys(config)).filter(([, key]) => !administrators.has(key)),
  );
  const botScope = config.botTextChannels;
  const botDenies = (channelKey: string) =>
    botScope && !botScope.channels.includes(channelKey)
      ? [{ roleKey: botScope.role, deny: PermissionFlagsBits.ViewChannel }]
      : [];
  const voiceAllows = config.voiceAccess.map((entry) => ({
    roleKey: entry.role,
    allow: permissionBits(entry.allow),
  }));

  const allyKey = config.settings.allyRole;
  const asSoldier = (keys: string[] | undefined) => [
    ...(keys ?? []),
    ...(allyKey && !keys?.includes(allyKey) ? [allyKey] : []),
  ];

  const allianceRoles = config.alliances.map((alliance) => ({
    key: alliance.key,
    name: alliance.legion,
    color: config.settings.alliances.color ?? 0,
    hoist: true,
    mentionable: false,
    permissions: 0n,
  }));
  const roles = config.roles
    .filter((role) => role.managed)
    .flatMap((role) => [
      ...(role.key === allyKey ? allianceRoles : []),
      {
        key: role.key,
        name: role.name,
        color: role.color ?? 0,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: permissionBits(role.permissions),
      },
    ]);

  const categories = config.categories
    .filter((category) => category.managed)
    .map((category) => {
      const hasVoice =
        category.channels.some((c) => isVoiceKind(c.type)) ||
        config.voiceGenerators.some((g) => g.category === category.key);
      return {
        key: category.key,
        name: category.name,
        overwrites: computeOverwrites({
          kind: 'category',
          view: category.access.view,
          write: category.access.write,
          tierRoleKeys: tiers,
          asSoldierRoleKeys: asSoldier(category.access.asSoldier),
          ...(hasVoice && { extraAllows: voiceAllows }),
        }),
      };
    });

  const channels: DesiredChannel[] = [];
  for (const category of config.categories) {
    for (const channel of category.channels.filter((c) => c.managed)) {
      const access = { ...category.access, ...channel.access };
      const isVoice = isVoiceKind(channel.type);
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
          asSoldierRoleKeys: asSoldier(access.asSoldier),
          ...(channel.allowSlashCommands && { slashCommands: channel.allowSlashCommands }),
          extraAllows: [
            ...(isVoice ? voiceAllows : []),
            ...channel.allow.map((extra) => ({
              roleKey: extra.role,
              allow: permissionBits(extra.permissions),
            })),
          ],
          extraDenies: [
            ...(isVoice ? [] : botDenies(channel.key)),
            ...channel.deny.map((extra) => ({
              roleKey: extra.role,
              deny: permissionBits(extra.permissions),
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
          asSoldierRoleKeys: asSoldier(category.access.asSoldier),
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
      color: COLORS.crimson,
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
            color: COLORS.green,
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
