import { MessageFlags, type InteractionReplyOptions, type RepliableInteraction } from 'discord.js';
import type { ServiceOutcome } from '../core/action.js';
import { ptBR } from '../i18n/pt-BR.js';

type NotOk = Exclude<ServiceOutcome<unknown>, { status: 'ok' }>;

/** Why an action didn't run (refused, not allowed), or the preview it waits to be confirmed on. */
export function failureText(outcome: NotOk): string {
  switch (outcome.status) {
    case 'denied':
      return ptBR.errors.denied(outcome.requiredTier);
    case 'rejected':
      return `⚠️ ${outcome.reason}`;
    case 'confirmation_required':
      return outcome.preview;
  }
}

/** Text for any outcome of an action whose result is a message. */
export function outcomeText(outcome: ServiceOutcome<string>): string {
  return outcome.status === 'ok' ? outcome.value : failureText(outcome);
}

export type PrivateReply =
  string | Pick<InteractionReplyOptions, 'content' | 'embeds' | 'components' | 'allowedMentions'>;

/**
 * Answers only whoever clicked or typed (the bot sends no DMs). Edits the reply when the
 * interaction was already deferred.
 */
export async function replyPrivately(
  interaction: RepliableInteraction,
  reply: PrivateReply,
): Promise<void> {
  const options = typeof reply === 'string' ? { content: reply } : reply;
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(options);
  } else {
    await interaction.reply({ ...options, flags: MessageFlags.Ephemeral });
  }
}
