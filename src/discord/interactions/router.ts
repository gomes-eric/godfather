import {
  Events,
  MessageFlags,
  type ButtonInteraction,
  type Client,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import { handleConfirmationButton } from './confirmation.js';
import { handlePartyButton } from './party.js';
import { handleRankingSelect } from './ranking.js';
import { handleRecruitButton, handleRecruitModal } from './recruitment.js';
import { handleRoomKickSelect, handleRoomPanelButton, handleRoomPanelModal } from './room-panel.js';
import { handleRsvpButton } from './rsvp.js';
import { handleSayModal } from './say.js';

/** Answers the interaction if it is its own (by custom id prefix); false lets the next one try. */
type Handler<T> = (interaction: T, ctx: CommandContext) => Promise<boolean>;

const buttons: Handler<ButtonInteraction>[] = [
  (interaction, ctx) => handleConfirmationButton(interaction, ctx.confirmations),
  handlePartyButton,
  handleRecruitButton,
  handleRsvpButton,
  handleRoomPanelButton,
];
const modals: Handler<ModalSubmitInteraction>[] = [
  handleSayModal,
  handleRecruitModal,
  handleRoomPanelModal,
];
const selectMenus: Handler<StringSelectMenuInteraction>[] = [
  handleRankingSelect,
  handleRoomKickSelect,
];

async function dispatch<T extends { customId: string }>(
  handlers: Handler<T>[],
  interaction: T,
  ctx: CommandContext,
): Promise<void> {
  for (const handle of handlers) {
    if (await handle(interaction, ctx)) return;
  }
  ctx.logger.warn({ customId: interaction.customId }, 'no handler for this interaction');
}

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
        await replyWithError(interaction, ptBR.errors.wrongGuild);
        return;
      }

      if (interaction.isChatInputCommand()) {
        const command = byName.get(interaction.commandName);
        if (command) await command.execute(interaction, ctx);
        else ctx.logger.warn({ command: interaction.commandName }, 'unknown slash command');
      } else if (interaction.isButton()) {
        await dispatch(buttons, interaction, ctx);
      } else if (interaction.isModalSubmit()) {
        await dispatch(modals, interaction, ctx);
      } else if (interaction.isStringSelectMenu()) {
        await dispatch(selectMenus, interaction, ctx);
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
