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

    if (ctx.legion.isChecking) {
      await interaction.editReply(t.commandBusy);
      return;
    }
    const outcome = await ctx.runAction({
      actor,
      action: 'legion.check',
      preview: 'legion.check',
      execute: async () => ({
        changes: (await ctx.legion.check()).length,
        members: ctx.registrations.all().length,
      }),
    });
    await interaction.editReply(
      outcome.status === 'ok'
        ? t.commandDone(outcome.value.members, outcome.value.changes)
        : failureText(outcome),
    );
  },
};
