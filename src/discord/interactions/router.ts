import { Events, MessageFlags, type Client, type Interaction } from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import { handleConfirmationButton } from './confirmation.js';
import { handlePartyButton } from '../commands/party.js';
import { handleSayModal } from '../commands/say.js';
import { handleRankingSelect } from './ranking.js';
import { handleRecruitButton, handleRecruitModal } from './recruitment.js';
import { handleRoomKickSelect, handleRoomPanelButton, handleRoomPanelModal } from './room-panel.js';
import { handleRsvpButton } from './rsvp.js';

async function replyWithError(interaction: Interaction, content: string): Promise<void> {
  if (!interaction.isRepliable()) return;
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}

/** Dispatches slash commands, buttons, forms and menus; any unexpected error becomes a generic reply. */
export function attachInteractionRouter(
  client: Client,
  commands: SlashCommand[],
  ctx: CommandContext,
): void {
  const byName = new Map(commands.map((command) => [command.data.name, command]));

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.guildId !== ctx.guild.id) {
        if (interaction.isRepliable()) await replyWithError(interaction, ptBR.errors.wrongGuild);
        return;
      }

      if (interaction.isChatInputCommand()) {
        const command = byName.get(interaction.commandName);
        if (!command) {
          ctx.logger.warn({ command: interaction.commandName }, 'unknown slash command');
          return;
        }
        await command.execute(interaction, ctx);
        return;
      }

      if (interaction.isButton()) {
        const handled =
          (await handleConfirmationButton(interaction, ctx.confirmations)) ||
          (await handlePartyButton(interaction, ctx)) ||
          (await handleRecruitButton(interaction, ctx)) ||
          (await handleRsvpButton(interaction, ctx)) ||
          (await handleRoomPanelButton(interaction, ctx));
        if (!handled) ctx.logger.warn({ customId: interaction.customId }, 'unknown button');
        return;
      }

      if (interaction.isModalSubmit()) {
        const handled =
          (await handleSayModal(interaction, ctx)) ||
          (await handleRecruitModal(interaction, ctx)) ||
          (await handleRoomPanelModal(interaction, ctx));
        if (!handled) ctx.logger.warn({ customId: interaction.customId }, 'unknown modal');
        return;
      }

      if (interaction.isStringSelectMenu()) {
        const handled =
          (await handleRankingSelect(interaction, ctx)) ||
          (await handleRoomKickSelect(interaction, ctx));
        if (!handled) ctx.logger.warn({ customId: interaction.customId }, 'unknown select menu');
      }
    } catch (error) {
      ctx.logger.error(
        { err: error, interaction: interaction.id, user: interaction.user.id },
        'interaction failed',
      );
      await replyWithError(interaction, ptBR.errors.unexpected).catch((replyError: unknown) =>
        ctx.logger.warn({ err: replyError }, 'could not report the interaction error'),
      );
    }
  });
}
