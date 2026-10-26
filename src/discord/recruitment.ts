import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { formatStat } from '../core/legion-check.js';
import type { Application } from '../db/applications.js';
import { ptBR } from '../i18n/pt-BR.js';

const t = ptBR.recruitment;
/** "Quero entrar na legião": the button on the #recrutamento panel. */
export { RECRUIT_APPLY_ID } from '../setup/desired.js';
export const RECRUIT_MODAL_ID = 'recruit:submit';
/** Officer buttons on an application card: `recruit:<approve|reject>:<applicationId>`. */
export const RECRUIT_DECIDE_PREFIX = 'recruit:';
export const RECRUIT_FIELDS = { name: 'name', schedule: 'schedule', reason: 'reason' } as const;

const COLORS = { pending: 0xa855f7, approved: 0x4fb286, rejected: 0x6e7f99 };

/** The application form, with the character name pre-filled when they registered one. */
export function applicationModal(characterName: string | undefined): ModalBuilder {
  const name = new TextInputBuilder()
    .setCustomId(RECRUIT_FIELDS.name)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(30)
    .setPlaceholder(t.namePlaceholder);
  if (characterName) name.setValue(characterName);
  const schedule = new TextInputBuilder()
    .setCustomId(RECRUIT_FIELDS.schedule)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setPlaceholder(t.schedulePlaceholder);
  const reason = new TextInputBuilder()
    .setCustomId(RECRUIT_FIELDS.reason)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500)
    .setPlaceholder(t.reasonPlaceholder);
  return new ModalBuilder()
    .setCustomId(RECRUIT_MODAL_ID)
    .setTitle(t.modalTitle)
    .addLabelComponents(
      new LabelBuilder().setLabel(t.nameLabel).setTextInputComponent(name),
      new LabelBuilder().setLabel(t.scheduleLabel).setTextInputComponent(schedule),
      new LabelBuilder().setLabel(t.reasonLabel).setTextInputComponent(reason),
    );
}

export function decideCustomId(action: 'approve' | 'reject', id: number): string {
  return `${RECRUIT_DECIDE_PREFIX}${action}:${id}`;
}

/** The card officers review: who, the character from the game, and Aprovar/Recusar. */
export function applicationCard(
  application: Application,
  look: { classEmoji: string; avatarUrl: string | null; legionName: string },
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const a = application;
  const embed = new EmbedBuilder()
    .setColor(COLORS[a.status])
    .setTitle(t.cardTitle(a.characterName))
    .setDescription(
      [
        t.applicant(a.userId),
        a.status === 'pending'
          ? t.pending
          : a.status === 'approved'
            ? t.approvedBy(a.decidedBy ?? '')
            : t.rejectedBy(a.decidedBy ?? ''),
      ].join('\n'),
    )
    .addFields(
      {
        name: t.classField,
        value: `${look.classEmoji} ${a.className} · ${t.level(a.level)}`,
        inline: true,
      },
      {
        name: t.powerField,
        value: `⚔️ ${formatStat(a.combatPower)} · 🎚️ ${formatStat(a.itemLevel)}`,
        inline: true,
      },
      { name: t.legionField, value: a.legion || t.noLegion, inline: true },
      { name: t.scheduleField, value: a.schedule.slice(0, 1024) },
      { name: t.reasonField, value: a.reason.slice(0, 1024) },
    )
    .setFooter({ text: t.footer(a.id, look.legionName) })
    .setTimestamp(a.createdAt);
  if (look.avatarUrl) embed.setThumbnail(look.avatarUrl);

  if (a.status !== 'pending') return { embeds: [embed], components: [] };
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(decideCustomId('approve', a.id))
      .setLabel(t.approve)
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(decideCustomId('reject', a.id))
      .setLabel(t.reject)
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}
