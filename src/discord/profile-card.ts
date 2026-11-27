import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { classRoles, type ServerConfig } from '../config/schema.js';
import {
  itemLabel,
  matchClass,
  type EquipmentGroup,
  type ItemDetail,
} from '../core/game-character.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { CharacterKey, GearPiece } from '../services/character-lookup.service.js';
import type { CharacterSheet } from '../services/game-character.service.js';
import { COLORS } from './colors.js';
import { customId, numericPart, parseCustomId } from './custom-id.js';

const t = ptBR.profile;
const GROUPS: { group: EquipmentGroup[]; name: string }[] = [
  { group: ['weapons'], name: t.weapons },
  { group: ['armor'], name: t.armor },
  { group: ['accessories'], name: t.accessories },
  { group: ['runes', 'arcana'], name: t.runesArcana },
];

const format = (value: number | null) =>
  value === null ? '—' : `**${value.toLocaleString('pt-BR')}**`;

export function profileCard(
  { profile, equipment }: CharacterSheet,
  look: { classEmoji?: string; color?: number; serverName: string },
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(look.color || COLORS.brand)
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

export function characterCard(sheet: CharacterSheet, config: ServerConfig): EmbedBuilder {
  const classRole = matchClass(sheet.profile.className, classRoles(config));
  return profileCard(sheet, {
    ...(classRole?.emoji && { classEmoji: classRole.emoji }),
    ...(classRole?.color !== undefined && { color: classRole.color }),
    serverName: config.settings.characters.serverName,
  });
}

export function characterMessage(sheet: CharacterSheet, config: ServerConfig) {
  return { embeds: [characterCard(sheet, config)], components: gearMenu(sheet) };
}

export const GEAR_PREFIX = 'gear:';
/** Discord's limit of options in a select menu. */
const MAX_OPTIONS = 25;

export function gearMenu({
  profile,
  equipment,
}: CharacterSheet): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const pieces = equipment.filter((item) => item.id > 0).slice(0, MAX_OPTIONS);
  if (pieces.length === 0) return [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId(GEAR_PREFIX, profile.serverId, profile.id))
    .setPlaceholder(t.gearPlaceholder)
    .addOptions(
      pieces.map((item) => ({
        label: itemLabel(item).slice(0, 100),
        description: t.gearOption(t.slots[item.slot] ?? item.slot).slice(0, 100),
        value: gearValue(item),
      })),
    );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

export function parseGearMenuId(id: string): CharacterKey | undefined {
  const parts = parseCustomId(id, GEAR_PREFIX);
  if (!parts) return undefined;
  const [rawServerId, ...idParts] = parts;
  const serverId = numericPart(rawServerId);
  const characterId = idParts.join(':');
  return serverId !== undefined && characterId ? { id: characterId, serverId } : undefined;
}

export function gearValue(item: GearPiece): string {
  return `${item.slotPos}:${item.id}:${item.enchantLevel}`;
}

export function parseGearValue(value: string): GearPiece | undefined {
  const [slotPos, id, enchantLevel] = value.split(':').map(Number);
  return [slotPos, id, enchantLevel].every((n) => Number.isInteger(n))
    ? { slotPos: slotPos!, id: id!, enchantLevel: enchantLevel! }
    : undefined;
}

export function itemCard(item: ItemDetail, characterName: string): EmbedBuilder {
  const enchant = item.enchantLevel > 0 ? `+${item.enchantLevel} ` : '';
  const header = [
    [item.gradeName, item.category].filter(Boolean).join(' · '),
    [
      item.level !== null ? t.pieceLevel(item.level) : null,
      t.enchant(item.enchantLevel, item.maxEnchantLevel),
    ]
      .filter(Boolean)
      .join(' · '),
    ...(item.classes.length > 0 ? [t.classes(item.classes)] : []),
  ].filter(Boolean);

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(`${enchant}${item.name}`.slice(0, 256))
    .setDescription(header.join('\n'))
    .setFooter({ text: t.itemFooter(characterName) });
  if (item.icon) embed.setThumbnail(item.icon);

  const field = (name: string, lines: string[]) => {
    if (lines.length > 0) embed.addFields({ name, value: lines.join('\n').slice(0, 1024) });
  };
  field(
    t.mainStats,
    item.mainStats.map(
      (s) => `${s.name}: **${s.value}**${s.extra ? ` (${s.extra} do encantamento)` : ''}`,
    ),
  );
  field(
    t.subStats,
    item.subStats.map((s) => `${s.name}: **${s.value}**`),
  );
  field(
    t.magicStones,
    item.magicStones.map((s) => `${s.name} **${s.value}**`),
  );
  field(
    t.godStones,
    item.godStones.map((s) => `**${s.name}**${s.description ? `\n${s.description}` : ''}`),
  );
  field(t.trade, [
    item.tradable ? t.tradable : t.notTradable,
    ...(item.sources.length > 0 ? [t.sources(item.sources)] : []),
  ]);
  return embed;
}
