import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { failureText } from '../replies.js';
import type { SlashCommand } from './types.js';

const t = ptBR.legionCheck;

export const rankingCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Update #ranking now, reading every character again on the official site')
    .setDescriptionLocalizations({
      'pt-BR': 'Atualiza o #ranking agora, relendo os personagens no site oficial',
    })
    .toJSON(),

  async execute(interaction, ctx) {
    const actor = await ctx.resolveActor(interaction.user.id);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const outcome = await ctx.legion.runNow(actor);
    await interaction.editReply(
      outcome.status === 'ok'
        ? t.commandDone(outcome.value.members, outcome.value.report.length)
        : failureText(outcome),
    );
  },
};
