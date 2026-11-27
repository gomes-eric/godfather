import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { characterMessage } from '../profile-card.js';
import { failureText } from '../replies.js';
import type { SlashCommand } from './types.js';

export const profileCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Show an Aion 2 character: combat power, item level and gear')
    .setDescriptionLocalizations({
      'pt-BR': 'Mostra um personagem do Aion 2: poder de combate, nível de item e equipamentos',
    })
    .addStringOption((o) =>
      o
        .setName('nome')
        .setDescription('Character name (default: your registered one)')
        .setDescriptionLocalizations({
          'pt-BR': 'Nome do personagem (padrão: o seu, registrado)',
        })
        .setMaxLength(30),
    )
    .addUserOption((o) =>
      o
        .setName('membro')
        .setDescription('A member with a registered character')
        .setDescriptionLocalizations({ 'pt-BR': 'Um membro com personagem registrado' }),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const name = interaction.options.getString('nome')?.trim();
    const user = interaction.options.getUser('membro');
    const actor = await ctx.resolveActor(interaction.user.id);

    await interaction.deferReply();
    const outcome = await ctx.characters.sheetFor(
      actor,
      name ? { name } : { userId: user?.id ?? actor.userId },
    );
    if (outcome.status !== 'ok') {
      await interaction.deleteReply();
      await interaction.followUp({ content: failureText(outcome), flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.editReply(characterMessage(outcome.value, ctx.config.get()));
  },
};
