import { MessageFlags, type ButtonInteraction } from 'discord.js';
import type { RsvpStatus } from '../../db/events.js';
import { RSVP_PREFIX } from '../announcements.js';
import type { CommandContext } from '../commands/types.js';
import { numericPart, parseCustomId } from '../custom-id.js';
import { outcomeText } from '../replies.js';

const STATUSES = new Set<string>(['yes', 'maybe', 'no'] satisfies RsvpStatus[]);

export async function handleRsvpButton(
  interaction: ButtonInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  const [rawId, status] = parseCustomId(interaction.customId, RSVP_PREFIX) ?? [];
  const occurrenceId = numericPart(rawId);
  if (occurrenceId === undefined || !status || !STATUSES.has(status)) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.events.vote(actor, occurrenceId, status as RsvpStatus);
  await interaction.editReply(outcomeText(outcome));
  return true;
}
