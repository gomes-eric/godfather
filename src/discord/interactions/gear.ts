import { MessageFlags, type StringSelectMenuInteraction } from 'discord.js';
import type { CommandContext } from '../commands/types.js';
import { itemCard, parseGearMenuId, parseGearValue } from '../profile-card.js';
import { failureText } from '../replies.js';

export async function handleGearSelect(
  interaction: StringSelectMenuInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  const character = parseGearMenuId(interaction.customId);
  const piece = parseGearValue(interaction.values[0] ?? '');
  if (!character || !piece) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.characters.gearDetail(actor, character, piece);
  await interaction.editReply(
    outcome.status === 'ok'
      ? { embeds: [itemCard(outcome.value.item, outcome.value.characterName)] }
      : failureText(outcome),
  );
  return true;
}
