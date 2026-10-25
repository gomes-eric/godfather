import { Events, MessageFlags, type Client, type Interaction } from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import { handleConfirmationButton } from './confirmation.js';
import { handleRolePickerButton } from './role-picker.js';

async function replyWithError(interaction: Interaction, content: string): Promise<void> {
  if (!interaction.isRepliable()) return;
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}

/** Dispatches slash commands and buttons; any unexpected error becomes a generic reply. */
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
          (await handleRolePickerButton(interaction, ctx));
        if (!handled) ctx.logger.warn({ customId: interaction.customId }, 'unknown button');
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
