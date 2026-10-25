import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { runWithConfirmation } from '../interactions/confirmation.js';
import type { SlashCommand } from './types.js';

export const sayCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Send a message as Padrinho')
    .setDescriptionLocalizations({ 'pt-BR': 'Envia uma mensagem como o Padrinho' })
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Where to send it')
        .setDescriptionLocalizations({ 'pt-BR': 'Onde enviar' })
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName('text')
        .setDescription('The message (use \\n for line breaks)')
        .setDescriptionLocalizations({ 'pt-BR': 'A mensagem (use \\n para quebrar linha)' })
        .setMaxLength(2000)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName('title')
        .setDescription('Send as an embed with this title')
        .setDescriptionLocalizations({ 'pt-BR': 'Envia como embed com este título' })
        .setMaxLength(256),
    )
    .addBooleanOption((o) =>
      o
        .setName('allow-mentions')
        .setDescription('Let @everyone/@roles/@users in the text ping (default: no)')
        .setDescriptionLocalizations({
          'pt-BR': 'Deixa @everyone/@cargos/@pessoas no texto notificarem (padrão: não)',
        }),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const channel = interaction.options.getChannel('channel', true);
    // Slash command text can't contain real line breaks, so accept a literal "\n".
    const text = interaction.options.getString('text', true).replaceAll('\\n', '\n');
    const title = interaction.options.getString('title');
    const allowMentions = interaction.options.getBoolean('allow-mentions') ?? false;
    const actor = await ctx.resolveActor(interaction.user.id);

    await runWithConfirmation(interaction, ctx.confirmations, () =>
      ctx.messages.send(actor, channel.id, text, {
        allowMentions,
        ...(title !== null && { title }),
      }),
    );
  },
};
