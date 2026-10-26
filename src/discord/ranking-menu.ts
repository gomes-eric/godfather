import { ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { formatStat, topRanking, type RankingRow } from '../core/legion-check.js';
import { ptBR } from '../i18n/pt-BR.js';

/** The select menu under the #ranking card; its value is the chosen member's user id. */
export const RANKING_SELECT_ID = 'ranking:profile';

/** "See a member's profile" menu with the members on the board, in the same order. */
export function rankingMenu(
  rows: readonly (RankingRow & { userId: string })[],
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const top = topRanking(rows);
  if (top.length === 0) return [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(RANKING_SELECT_ID)
    .setPlaceholder(ptBR.legionCheck.menuPlaceholder)
    .addOptions(
      top.map((row, i) => ({
        label: `${i + 1}. ${row.name}`.slice(0, 100),
        description: ptBR.legionCheck.menuOption(
          formatStat(row.combatPower),
          formatStat(row.itemLevel),
        ),
        value: row.userId,
        emoji: row.classEmoji,
      })),
    );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}
