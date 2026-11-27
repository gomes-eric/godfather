import { MessageFlags, type StringSelectMenuInteraction } from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { GameApiError } from '../../services/game-character.service.js';
import type { CommandContext } from '../commands/types.js';
import { numericPart, parseCustomId } from '../custom-id.js';
import { GEAR_PREFIX, itemCard, parseGearValue } from '../profile-card.js';

const t = ptBR.profile;

export async function handleGearSelect(
  interaction: StringSelectMenuInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  const parts = parseCustomId(interaction.customId, GEAR_PREFIX);
  if (!parts) return false;
  const [rawServerId, ...idParts] = parts;
  const serverId = numericPart(rawServerId);
  const piece = parseGearValue(interaction.values[0] ?? '');
  const characterId = idParts.join(':');
  if (serverId === undefined || !characterId || !piece) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const item = await ctx.characters.item({ id: characterId, serverId }, piece);
    const owner = interaction.message.embeds[0]?.title ?? '';
    await interaction.editReply({ embeds: [itemCard(item, owner)] });
  } catch (error) {
    if (!(error instanceof GameApiError)) throw error;
    await interaction.editReply(`⚠️ ${t.apiDown}`);
  }
  return true;
}
