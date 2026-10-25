import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { ActionOutcome } from '../../core/action.js';
import { PendingConfirmations } from '../../core/confirm.js';
import { ptBR } from '../../i18n/pt-BR.js';

/**
 * A slash-command action that can run with or without confirmation. The value of a successful
 * outcome is the message shown to the user.
 */
export type ConfirmableOperation = (confirm: boolean) => Promise<ActionOutcome<string>>;

export type ConfirmationStore = PendingConfirmations<ConfirmableOperation>;

export function createConfirmationStore(): ConfirmationStore {
  return new PendingConfirmations<ConfirmableOperation>();
}

const CONFIRM_PREFIX = 'confirm:';
const CANCEL_PREFIX = 'cancel:';

function outcomeMessage(
  outcome: Exclude<ActionOutcome<string>, { status: 'confirmation_required' }>,
) {
  return outcome.status === 'ok' ? outcome.value : ptBR.errors.denied(outcome.requiredTier);
}

/**
 * Runs an operation for a slash command. Destructive actions first get an ephemeral preview
 * with Confirmar/Cancelar buttons; the button handler below finishes the job.
 */
export async function runWithConfirmation(
  interaction: ChatInputCommandInteraction,
  store: ConfirmationStore,
  operation: ConfirmableOperation,
): Promise<void> {
  const outcome = await operation(false);

  if (outcome.status !== 'confirmation_required') {
    await interaction.reply({ content: outcomeMessage(outcome), flags: MessageFlags.Ephemeral });
    return;
  }

  const id = store.create(interaction.user.id, operation);
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONFIRM_PREFIX}${id}`)
      .setLabel(ptBR.confirmation.confirmButton)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${CANCEL_PREFIX}${id}`)
      .setLabel(ptBR.confirmation.cancelButton)
      .setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({
    content: ptBR.confirmation.prompt(outcome.preview),
    components: [buttons],
    flags: MessageFlags.Ephemeral,
  });
}

/** Handles Confirmar/Cancelar clicks. Returns false if the button is not a confirmation button. */
export async function handleConfirmationButton(
  interaction: ButtonInteraction,
  store: ConfirmationStore,
): Promise<boolean> {
  const { customId } = interaction;
  const userId = interaction.user.id;

  if (customId.startsWith(CANCEL_PREFIX)) {
    store.cancel(customId.slice(CANCEL_PREFIX.length), userId);
    await interaction.update({ content: ptBR.confirmation.cancelled, components: [] });
    return true;
  }
  if (!customId.startsWith(CONFIRM_PREFIX)) return false;

  const operation = store.take(customId.slice(CONFIRM_PREFIX.length), userId);
  if (!operation) {
    await interaction.update({ content: ptBR.confirmation.expired, components: [] });
    return true;
  }

  await interaction.deferUpdate();
  // Re-runs the whole pipeline with confirm=true, so permissions are checked again at click time.
  const outcome = await operation(true);
  const content =
    outcome.status === 'confirmation_required'
      ? ptBR.confirmation.expired
      : outcomeMessage(outcome);
  await interaction.editReply({ content, components: [] });
  return true;
}
