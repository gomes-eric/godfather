import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { ServiceOutcome } from '../../core/action.js';
import { PendingConfirmations } from '../../core/confirm.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { customId, parseCustomId } from '../custom-id.js';
import { outcomeText, replyPrivately } from '../replies.js';

const t = ptBR.confirmation;

export type ConfirmableOperation = (confirm: boolean) => Promise<ServiceOutcome<string>>;

export type ConfirmationStore = PendingConfirmations<ConfirmableOperation>;

export function createConfirmationStore(): ConfirmationStore {
  return new PendingConfirmations<ConfirmableOperation>();
}

const CONFIRM_PREFIX = 'confirm:';
const CANCEL_PREFIX = 'cancel:';

export async function runWithConfirmation(
  interaction: ChatInputCommandInteraction,
  store: ConfirmationStore,
  operation: ConfirmableOperation,
): Promise<void> {
  const outcome = await operation(false);
  if (outcome.status !== 'confirmation_required') {
    await replyPrivately(interaction, outcomeText(outcome));
    return;
  }

  const id = store.create(interaction.user.id, operation);
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(CONFIRM_PREFIX, id))
      .setLabel(t.confirmButton)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(customId(CANCEL_PREFIX, id))
      .setLabel(t.cancelButton)
      .setStyle(ButtonStyle.Secondary),
  );
  await replyPrivately(interaction, { content: t.prompt(outcome.preview), components: [buttons] });
}

export async function handleConfirmationButton(
  interaction: ButtonInteraction,
  store: ConfirmationStore,
): Promise<boolean> {
  const userId = interaction.user.id;

  const [cancelId] = parseCustomId(interaction.customId, CANCEL_PREFIX) ?? [];
  if (cancelId) {
    store.cancel(cancelId, userId);
    await interaction.update({ content: t.cancelled, components: [] });
    return true;
  }
  const [confirmId] = parseCustomId(interaction.customId, CONFIRM_PREFIX) ?? [];
  if (!confirmId) return false;

  const operation = store.take(confirmId, userId);
  if (!operation) {
    await interaction.update({ content: t.expired, components: [] });
    return true;
  }

  await interaction.deferUpdate();
  const outcome = await operation(true);
  const content = outcome.status === 'confirmation_required' ? t.expired : outcomeText(outcome);
  await interaction.editReply({ content, components: [] });
  return true;
}
