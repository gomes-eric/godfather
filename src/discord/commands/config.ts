import { SlashCommandBuilder } from 'discord.js';
import { ConfigError } from '../../config/loader.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { failureText, replyPrivately } from '../replies.js';
import type { SlashCommand } from './types.js';

export const configCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Manage the bot configuration')
    .setDescriptionLocalizations({ 'pt-BR': 'Gerencia a configuração do bot' })
    .addSubcommand((sub) =>
      sub
        .setName('reload')
        .setDescription('Reload server.yaml without restarting')
        .setDescriptionLocalizations({ 'pt-BR': 'Recarrega o server.yaml sem reiniciar' }),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const actor = await ctx.resolveActor(interaction.user.id);

    let content: string;
    try {
      const outcome = await ctx.runAction({
        actor,
        action: 'config.reload',
        target: 'server.yaml',
        preview: 'config.reload',
        execute: async () => ctx.config.reload(),
      });
      if (outcome.status === 'ok') {
        const config = outcome.value;
        const channels = config.categories.reduce((n, c) => n + c.channels.length, 0);
        content = ptBR.config.reloaded(config.roles.length, channels);
      } else {
        content = failureText(outcome);
      }
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      content = ptBR.config.invalid(error.message);
    }

    await replyPrivately(interaction, content);
  },
};
