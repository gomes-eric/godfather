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
import { FORM_KINDS, type ApplicationKind } from '../core/application-rules.js';
import { formatStat } from '../core/legion-check.js';
import type { Application } from '../db/applications.js';
import { ptBR } from '../i18n/pt-BR.js';
import { COLORS } from './colors.js';
import { customId } from './custom-id.js';

const t = ptBR.recruitment;
export const RECRUIT_MODAL_ID = 'recruit:submit';
/** Officer controls on an application card: `recruit:<approve|reject|change|kind>:<applicationId>`. */
export const RECRUIT_DECIDE_PREFIX = 'recruit:';
export const RECRUIT_FIELDS = { kind: 'kind', name: 'name', note: 'note' } as const;

const STATUS_COLORS = { pending: COLORS.brand, approved: COLORS.green, rejected: COLORS.slate };

/** The application form, with the character name pre-filled when they registered one. */
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
  const note = new TextInputBuilder()
    .setCustomId(RECRUIT_FIELDS.note)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(300)
    .setPlaceholder(t.notePlaceholder);
  return new ModalBuilder()
    .setCustomId(RECRUIT_MODAL_ID)
    .setTitle(t.modalTitle)
    .addLabelComponents(
      new LabelBuilder().setLabel(t.kindLabel).setStringSelectMenuComponent(kind),
      new LabelBuilder()
        .setLabel(t.nameLabel)
        .setDescription(t.nameHint)
        .setTextInputComponent(name),
      new LabelBuilder().setLabel(t.noteLabel).setTextInputComponent(note),
    );
}

/** "⚔️ Membro", "🤝 Aliança · Noxus"… */
export function kindText(kind: ApplicationKind, allianceLegion: string | null): string {
  const { emoji, label } = t.kinds[kind];
  return kind === 'ally' && allianceLegion
    ? `${emoji} ${label} · ${allianceLegion}`
    : `${emoji} ${label}`;
}

export interface CardLook {
  classEmoji: string;
  avatarUrl: string | null;
  legionName: string;
  /** The applicant's name in Discord, for a Parceiro without a character. */
  applicantName: string;
  /** An Aliança whose legion is not an alliance yet. */
  newAlliance: boolean;
  /** The standing they had before the daily check changed it. */
  previousStanding: string | null;
}

/** The card officers review: who, the character from the game, the type, and the buttons. */
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
  const lines = [
    t.applicant(a.userId),
    ...(fromCheck ? [t.fromCheck(look.previousStanding ?? '')] : []),
    t.kindLine(kindText(a.kind, a.allianceLegion)),
    ...(a.requestedKind !== a.kind ? [t.pickedLine(kindText(a.requestedKind, null))] : []),
    ...(a.kind === 'ally' && look.newAlliance && a.status === 'pending'
      ? [t.newAllianceWarning(a.allianceLegion ?? '')]
      : []),
    ...(a.duplicateOf ? [t.duplicateWarning(a.duplicateOf)] : []),
    status,
  ];
  const embed = new EmbedBuilder()
    .setColor(STATUS_COLORS[a.status])
    .setTitle(
      fromCheck
        ? t.reviewTitle(a.characterName ?? look.applicantName)
        : t.cardTitle(a.characterName ?? look.applicantName),
    )
    .setDescription(lines.join('\n'))
    .setFooter({ text: fromCheck ? t.reviewFooter(a.id) : t.footer(a.id) })
    .setTimestamp(a.createdAt);
  if (a.characterName) {
    embed.addFields(
      {
        name: t.classField,
        value: `${look.classEmoji} ${a.className ?? '—'} · ${t.level(a.level ?? 0)}`,
        inline: true,
      },
      {
        name: t.powerField,
        value: `⚔️ ${formatStat(a.combatPower)} · 🎚️ ${formatStat(a.itemLevel)}`,
        inline: true,
      },
      { name: t.legionField, value: a.legion || t.noLegion, inline: true },
    );
  } else {
    embed.addFields({ name: t.characterField, value: t.noCharacter, inline: true });
  }
  if (a.note) embed.addFields({ name: t.noteField, value: a.note.slice(0, 1024) });
  if (look.avatarUrl) embed.setThumbnail(look.avatarUrl);

  if (a.status !== 'pending') return { embeds: [embed], components: [] };
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(RECRUIT_DECIDE_PREFIX, 'approve', a.id))
      .setLabel(t.approve)
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(customId(RECRUIT_DECIDE_PREFIX, 'reject', a.id))
      .setLabel(t.reject)
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(customId(RECRUIT_DECIDE_PREFIX, 'change', a.id))
      .setLabel(t.change)
      .setEmoji('🔀')
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

/**
 * Mudar's menu, shown only to the officer: the types approving can give. Aliança uses the
 * character's legion; Restrito is offered on the daily check's reviews only.
 */
export function kindMenu(application: Application): ActionRowBuilder<StringSelectMenuBuilder> {
  const kinds: ApplicationKind[] =
    application.origin === 'check'
      ? ['member', 'ally', 'partner', 'restricted']
      : ['member', 'ally', 'partner'];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId(RECRUIT_DECIDE_PREFIX, 'kind', application.id))
    .setPlaceholder(t.changePlaceholder)
    .addOptions(
      kinds.map((kind) => ({
        value: kind,
        label:
          kind === 'ally'
            ? application.legion
              ? `${t.kinds.ally.label} · ${application.legion}`
              : t.allyNoLegionOption
            : t.kinds[kind].label,
        emoji: t.kinds[kind].emoji,
        default: kind === application.kind,
      })),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}
