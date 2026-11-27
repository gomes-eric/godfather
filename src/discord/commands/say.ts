import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { authorize } from '../../core/permissions.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { runWithConfirmation } from '../interactions/confirmation.js';
import { sayModal } from '../interactions/say.js';
import { replyPrivately } from '../replies.js';
import type { SlashCommand } from './types.js';

export const sayCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Send a message as Padrinho')
    .setDescriptionLocalizations({ 'pt-BR': 'Envia uma mensagem como o Padrinho' })
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Where to send it (text channels and voice channel chats)')
        .setDescriptionLocalizations({
          'pt-BR': 'Onde enviar (canais de texto e chat das salas de voz)',
        })
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildVoice,
          ChannelType.GuildStageVoice,
        )
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName('text')
        .setDescription('The message; leave empty to write it in a form with line breaks')
        .setDescriptionLocalizations({
          'pt-BR': 'A mensagem; deixe vazio para escrever num formulário com quebras de linha',
        })
        .setMaxLength(2000),
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
    const rawText = interaction.options.getString('text');
    const title = interaction.options.getString('title');
    const allowMentions = interaction.options.getBoolean('allow-mentions') ?? false;
    const actor = await ctx.resolveActor(interaction.user.id);

    if (rawText === null) {
      const allowed = authorize(actor.tier, 'message.send');
      if (!allowed.allowed) {
        await replyPrivately(interaction, ptBR.errors.denied(allowed.requiredTier));
        return;
      }
      await interaction.showModal(sayModal(channel.id, allowMentions));
      return;
    }

    // Slash command text can't contain real line breaks, so accept a literal "\n".
    const text = rawText.replaceAll('\\n', '\n');
    await runWithConfirmation(interaction, ctx.confirmations, () =>
      ctx.messages.send(actor, channel.id, text, {
        allowMentions,
        ...(title !== null && { title }),
      }),
    );
  },
};
