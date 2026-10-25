import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { RSVP_PREFIX } from '../announcements.js';
import type { CommandContext } from '../commands/types.js';
import { outcomeMessage } from './confirmation.js';

const STATUSES = new Set(['yes', 'maybe', 'no']);

/** ✅ / ❔ / ❌ buttons under event reminders (PLAN.md §6.5). */
export async function handleRsvpButton(
  interaction: ButtonInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (!interaction.customId.startsWith(RSVP_PREFIX)) return false;

  const [rawId, status] = interaction.customId.slice(RSVP_PREFIX.length).split(':');
  const occurrenceId = Number(rawId);
  if (!Number.isInteger(occurrenceId) || !status || !STATUSES.has(status)) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.events.vote(actor, occurrenceId, status as 'yes' | 'maybe' | 'no');
  await interaction.editReply({
    content: outcome.status === 'confirmation_required' ? outcome.preview : outcomeMessage(outcome),
  });
  return true;
}
