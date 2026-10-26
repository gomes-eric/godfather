import { EmbedBuilder } from 'discord.js';
import type { ServerConfig } from '../config/schema.js';
import { itemLabel, matchClass, type EquipmentGroup } from '../core/game-character.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { CharacterSheet } from '../services/game-character.service.js';

const t = ptBR.profile;
const DEFAULT_COLOR = 0xa855f7;
const GROUPS: { group: EquipmentGroup[]; name: string }[] = [
  { group: ['weapons'], name: t.weapons },
  { group: ['armor'], name: t.armor },
  { group: ['accessories'], name: t.accessories },
  { group: ['runes', 'arcana'], name: t.runesArcana },
];

const format = (value: number | null) =>
  value === null ? '—' : `**${value.toLocaleString('pt-BR')}**`;

/** The /perfil card: class, level, combat power, item level, legion, title and gear. */
export function profileCard(
  { profile, equipment }: CharacterSheet,
  look: { classEmoji?: string; color?: number; serverName: string },
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(look.color || DEFAULT_COLOR)
    .setTitle(profile.name)
    .setDescription(
      [
        `${look.classEmoji ?? '🎮'} **${profile.className}** · ${t.level(profile.level)}`,
        profile.legion ? t.legion(profile.legion) : t.noLegion,
        ...(profile.title ? [`🏷️ ${profile.title}`] : []),
      ].join('\n'),
    )
    .addFields(
      { name: t.combatPower, value: format(profile.combatPower), inline: true },
      { name: t.itemLevel, value: format(profile.itemLevel), inline: true },
    )
    .setFooter({ text: t.footer(look.serverName) })
    .setTimestamp(new Date());
  if (profile.avatarUrl) embed.setThumbnail(profile.avatarUrl);

  for (const { group, name } of GROUPS) {
    const lines = equipment.filter((item) => group.includes(item.group)).map(itemLabel);
    if (lines.length === 0) continue;
    embed.addFields({ name, value: lines.join('\n').slice(0, 1024) });
  }
  if (equipment.length === 0) embed.addFields({ name: t.gear, value: t.noGear });
  return embed;
}

/** The profile card with the class emoji and color from server.yaml. */
export function characterCard(sheet: CharacterSheet, config: ServerConfig): EmbedBuilder {
  const classRole = matchClass(
    sheet.profile.className,
    config.roles.filter((role) => role.class),
  );
  return profileCard(sheet, {
    ...(classRole?.emoji && { classEmoji: classRole.emoji }),
    ...(classRole?.color !== undefined && { color: classRole.color }),
    serverName: (config.settings as { game?: { server?: string } }).game?.server ?? 'Triniel',
  });
}
