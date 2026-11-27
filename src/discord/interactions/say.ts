import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ModalSubmitInteraction,
} from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import type { CommandContext } from '../commands/types.js';
import { customId, parseCustomId } from '../custom-id.js';
import { outcomeText } from '../replies.js';

const t = ptBR.say;
const SAY_MODAL_PREFIX = 'say:';
const TITLE_FIELD = 'title';
const TEXT_FIELD = 'text';
/** An embed description holds 4096 characters; a plain message 2000 (longer goes as embed). */
const MAX_TEXT = 4000;

export function sayModal(channelId: string, allowMentions: boolean): ModalBuilder {
  const title = new TextInputBuilder()
    .setCustomId(TITLE_FIELD)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(256)
    .setPlaceholder(t.titlePlaceholder);
  const text = new TextInputBuilder()
    .setCustomId(TEXT_FIELD)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(MAX_TEXT)
    .setPlaceholder(t.textPlaceholder);
  return new ModalBuilder()
    .setCustomId(customId(SAY_MODAL_PREFIX, channelId, allowMentions ? 1 : 0))
    .setTitle(t.modalTitle)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(t.titleLabel)
        .setDescription(t.titleHint)
        .setTextInputComponent(title),
      new LabelBuilder().setLabel(t.textLabel).setTextInputComponent(text),
    );
}

export async function handleSayModal(
  interaction: ModalSubmitInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  const [channelId, mentions] = parseCustomId(interaction.customId, SAY_MODAL_PREFIX) ?? [];
  if (!channelId) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const title = interaction.fields.getTextInputValue(TITLE_FIELD).trim();
  const text = interaction.fields.getTextInputValue(TEXT_FIELD);
  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.messages.send(actor, channelId, text, {
    allowMentions: mentions === '1',
    ...(title && { title }),
  });
  await interaction.editReply(outcomeText(outcome));
  return true;
}
