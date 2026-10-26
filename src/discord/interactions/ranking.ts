import { MessageFlags, type StringSelectMenuInteraction } from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { GameApiError } from '../../services/game-character.service.js';
import type { CommandContext } from '../commands/types.js';
import { characterCard } from '../profile-card.js';
import { RANKING_SELECT_ID } from '../ranking-menu.js';

/** The #ranking menu: the chosen member's profile, shown only to whoever chose. */
export async function handleRankingSelect(
  interaction: StringSelectMenuInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (interaction.customId !== RANKING_SELECT_ID) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const registered = ctx.registrations.get(interaction.values[0] ?? '');
  if (!registered) {
    await interaction.editReply(`⚠️ ${ptBR.legionCheck.menuGone}`);
    return true;
  }
  try {
    const sheet = await ctx.characters.sheet({
      id: registered.characterId,
      serverId: registered.serverId,
    });
    await interaction.editReply({ embeds: [characterCard(sheet, ctx.config.get())] });
  } catch (error) {
    if (!(error instanceof GameApiError)) throw error;
    await interaction.editReply(`⚠️ ${ptBR.profile.apiDown}`);
  }
  return true;
}
