import { ChannelType, SlashCommandBuilder, type SlashCommandStringOption } from 'discord.js';
import { runWithConfirmation } from '../interactions/confirmation.js';
import type { SlashCommand } from './types.js';

const reason = (o: SlashCommandStringOption) =>
  o
    .setName('reason')
    .setDescription('Why (shown in the audit log)')
    .setDescriptionLocalizations({ 'pt-BR': 'Motivo (vai para a auditoria)' })
    .setMaxLength(400);

export const modCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Moderation tools')
    .setDescriptionLocalizations({ 'pt-BR': 'Ferramentas de moderação' })
    .addSubcommand((sub) =>
      sub
        .setName('kick')
        .setDescription('Kick a member')
        .setDescriptionLocalizations({ 'pt-BR': 'Expulsa um membro' })
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addStringOption(reason),
    )
    .addSubcommand((sub) =>
      sub
        .setName('ban')
        .setDescription('Ban a user (Comandante only)')
        .setDescriptionLocalizations({ 'pt-BR': 'Bane alguém (só Comandante)' })
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addStringOption(reason)
        .addIntegerOption((o) =>
          o
            .setName('delete-messages')
            .setDescription('Also delete their recent messages')
            .setDescriptionLocalizations({ 'pt-BR': 'Também apaga as mensagens recentes' })
            .addChoices(
              { name: 'Não apagar', value: 0 },
              { name: 'Última hora', value: 1 },
              { name: 'Últimas 24 horas', value: 24 },
              { name: 'Últimos 7 dias', value: 168 },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('unban')
        .setDescription('Unban a user (Comandante only)')
        .setDescriptionLocalizations({ 'pt-BR': 'Desbane alguém (só Comandante)' })
        .addUserOption((o) =>
          o.setName('user').setDescription('Who (or their id)').setRequired(true),
        )
        .addStringOption(reason),
    )
    .addSubcommand((sub) =>
      sub
        .setName('timeout')
        .setDescription('Mute a member for a while (0 removes the timeout)')
        .setDescriptionLocalizations({
          'pt-BR': 'Silencia um membro por um tempo (0 remove o timeout)',
        })
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addIntegerOption((o) =>
          o
            .setName('minutes')
            .setDescription('Duration in minutes (max 28 days)')
            .setDescriptionLocalizations({ 'pt-BR': 'Duração em minutos (máx. 28 dias)' })
            .setMinValue(0)
            .setMaxValue(40320)
            .setRequired(true),
        )
        .addStringOption(reason),
    )
    .addSubcommand((sub) =>
      sub
        .setName('purge')
        .setDescription('Delete recent messages in a channel')
        .setDescriptionLocalizations({ 'pt-BR': 'Apaga mensagens recentes de um canal' })
        .addIntegerOption((o) =>
          o
            .setName('count')
            .setDescription('How many (1-100)')
            .setDescriptionLocalizations({ 'pt-BR': 'Quantas (1-100)' })
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(true),
        )
        .addUserOption((o) =>
          o
            .setName('user')
            .setDescription('Only messages from this user')
            .setDescriptionLocalizations({ 'pt-BR': 'Só mensagens desta pessoa' }),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel (default: this one)')
            .setDescriptionLocalizations({ 'pt-BR': 'Canal (padrão: este)' })
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const actor = await ctx.resolveActor(interaction.user.id);
    const why = interaction.options.getString('reason');

    switch (sub) {
      case 'kick': {
        const user = interaction.options.getUser('user', true);
        return runWithConfirmation(interaction, ctx.confirmations, (confirm) =>
          ctx.moderation.kick(actor, user.id, why, confirm),
        );
      }
      case 'ban': {
        const user = interaction.options.getUser('user', true);
        const hours = interaction.options.getInteger('delete-messages') ?? 0;
        return runWithConfirmation(interaction, ctx.confirmations, (confirm) =>
          ctx.moderation.ban(actor, user.id, why, hours, confirm),
        );
      }
      case 'unban': {
        const user = interaction.options.getUser('user', true);
        return runWithConfirmation(interaction, ctx.confirmations, () =>
          ctx.moderation.unban(actor, user.id, why),
        );
      }
      case 'timeout': {
        const user = interaction.options.getUser('user', true);
        const minutes = interaction.options.getInteger('minutes', true);
        return runWithConfirmation(interaction, ctx.confirmations, () =>
          ctx.moderation.timeout(actor, user.id, minutes, why),
        );
      }
      case 'purge': {
        const count = interaction.options.getInteger('count', true);
        const author = interaction.options.getUser('user');
        const channelId = interaction.options.getChannel('channel')?.id ?? interaction.channelId;
        return runWithConfirmation(interaction, ctx.confirmations, (confirm) =>
          ctx.moderation.purge(actor, channelId, count, author?.id ?? null, confirm),
        );
      }
    }
  },
};
