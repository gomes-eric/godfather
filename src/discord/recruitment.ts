import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { FORM_KINDS, kindsFor, type ApplicationKind } from '../core/application-rules.js';
import { formatStat } from '../core/legion-check.js';
import type { Application } from '../db/applications.js';
import type { CardLook } from '../services/recruitment-board.js';
import { ptBR } from '../i18n/pt-BR.js';
import { COLORS } from './colors.js';
import { customId } from './custom-id.js';

const t = ptBR.recruitment;
export const RECRUIT_MODAL_ID = 'recruit:submit';
export const RECRUIT_CARD_PREFIX = 'recruit:';
export const RECRUIT_FIELDS = { kind: 'kind', name: 'name' } as const;

const STATUS_COLORS = { pending: COLORS.brand, approved: COLORS.green, rejected: COLORS.slate };

export function applicationModal(characterName: string | undefined): ModalBuilder {
  const kind = new StringSelectMenuBuilder()
    .setCustomId(RECRUIT_FIELDS.kind)
    .setRequired(true)
    .setPlaceholder(t.kindPlaceholder)
    .addOptions(
      FORM_KINDS.map((value) => ({
        value,
        label: t.kinds[value].label,
        description: t.kinds[value].hint,
        emoji: t.kinds[value].emoji,
      })),
    );
  const name = new TextInputBuilder()
    .setCustomId(RECRUIT_FIELDS.name)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(30)
    .setPlaceholder(t.namePlaceholder);
  if (characterName) name.setValue(characterName);
  return new ModalBuilder()
    .setCustomId(RECRUIT_MODAL_ID)
    .setTitle(t.modalTitle)
    .addLabelComponents(
      new LabelBuilder().setLabel(t.kindLabel).setStringSelectMenuComponent(kind),
      new LabelBuilder()
        .setLabel(t.nameLabel)
        .setDescription(t.nameHint)
        .setTextInputComponent(name),
    );
}

export function kindText(kind: ApplicationKind, allianceLegion: string | null): string {
  const { emoji, label } = t.kinds[kind];
  return kind === 'ally' && allianceLegion
    ? `${emoji} ${label} · ${allianceLegion}`
    : `${emoji} ${label}`;
}

export function applicationCard(
  application: Application,
  look: CardLook,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const a = application;
  const fromCheck = a.origin === 'check';
  const status =
    a.status === 'pending'
      ? t.pending
      : a.status === 'approved'
        ? t.approvedBy(a.decidedBy ?? '')
        : t.rejectedBy(a.decidedBy ?? '');
  const notices = [
    ...(fromCheck ? [t.fromCheck(look.previousStanding ?? '')] : []),
    ...(a.kind === 'ally' && look.newAlliance && a.status === 'pending'
      ? [t.newAllianceWarning(a.allianceLegion ?? '')]
      : []),
    ...(a.characterTakenBy ? [t.duplicateWarning(a.characterTakenBy)] : []),
  ];
  const kind = [
    kindText(a.kind, a.allianceLegion),
    ...(a.requestedKind !== a.kind ? [t.pickedLine(kindText(a.requestedKind, null))] : []),
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(STATUS_COLORS[a.status])
    .setTitle(
      fromCheck
        ? t.reviewTitle(a.character?.name ?? look.applicantName)
        : t.cardTitle(a.character?.name ?? look.applicantName),
    )
    .setFooter({ text: fromCheck ? t.reviewFooter(a.id) : t.footer(a.id) })
    .setTimestamp(a.createdAt)
    .addFields(
      { name: t.applicantField, value: `<@${a.userId}>`, inline: true },
      { name: t.kindField, value: kind, inline: true },
      { name: t.statusField, value: status, inline: true },
    );
  if (notices.length > 0) embed.setDescription(notices.join('\n\n'));
  const c = a.character;
  if (c) {
    embed.addFields(
      {
        name: t.classField,
        value: `${look.classEmoji} ${c.className} · ${t.level(c.level)}`,
        inline: true,
      },
      {
        name: t.powerField,
        value: `⚔️ ${formatStat(c.combatPower)} · 🎚️ ${formatStat(c.itemLevel)}`,
        inline: true,
      },
      { name: t.legionField, value: c.legion || t.noLegion, inline: true },
    );
  } else {
    embed.addFields({ name: t.characterField, value: t.noCharacter, inline: true });
  }
  if (look.avatarUrl) embed.setThumbnail(look.avatarUrl);

  if (a.status !== 'pending') return { embeds: [embed], components: [] };
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(RECRUIT_CARD_PREFIX, 'approve', a.id))
      .setLabel(t.approve)
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(customId(RECRUIT_CARD_PREFIX, 'reject', a.id))
      .setLabel(t.reject)
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(customId(RECRUIT_CARD_PREFIX, 'change', a.id))
      .setLabel(t.change)
      .setEmoji('🔀')
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

export function kindMenu(application: Application): ActionRowBuilder<StringSelectMenuBuilder> {
  const kinds = kindsFor(application.origin);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId(RECRUIT_CARD_PREFIX, 'kind', application.id))
    .setPlaceholder(t.changePlaceholder)
    .addOptions(
      kinds.map((kind) => ({
        value: kind,
        label:
          kind === 'ally'
            ? application.character?.legion
              ? `${t.kinds.ally.label} · ${application.character.legion}`
              : t.allyNoLegionOption
            : t.kinds[kind].label,
        emoji: t.kinds[kind].emoji,
        default: kind === application.kind,
      })),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}
