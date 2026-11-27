import { MessageFlags, type StringSelectMenuInteraction } from 'discord.js';
import type { CommandContext } from '../commands/types.js';
import { characterMessage } from '../profile-card.js';
import { RANKING_SELECT_ID } from '../ranking-menu.js';
import { failureText } from '../replies.js';

export async function handleRankingSelect(
  interaction: StringSelectMenuInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (interaction.customId !== RANKING_SELECT_ID) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.characters.sheetFor(actor, { userId: interaction.values[0] ?? '' });
  await interaction.editReply(
    outcome.status === 'ok'
      ? characterMessage(outcome.value, ctx.config.get())
      : failureText(outcome),
  );
  return true;
}
