import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { RoomCommand } from '../../services/voice.service.js';
import { runWithConfirmation } from '../interactions/confirmation.js';
import type { SlashCommand } from './types.js';

export const voiceCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Manage the temporary voice room you are in')
    .setDescriptionLocalizations({ 'pt-BR': 'Gerencia a sala de voz temporária em que você está' })
    .addSubcommand((sub) =>
      sub
        .setName('rename')
        .setDescription('Rename the room (Discord allows 2 renames per 10 minutes)')
        .setDescriptionLocalizations({
          'pt-BR': 'Renomeia a sala (o Discord permite 2 trocas a cada 10 minutos)',
        })
        .addStringOption((o) =>
          o.setName('name').setDescription('New name').setMaxLength(100).setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('limit')
        .setDescription('Set how many people fit (0 = no limit)')
        .setDescriptionLocalizations({ 'pt-BR': 'Define quantas pessoas cabem (0 = sem limite)' })
        .addIntegerOption((o) =>
          o
            .setName('limit')
            .setDescription('0-99')
            .setMinValue(0)
            .setMaxValue(99)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('lock')
        .setDescription('Nobody new can join')
        .setDescriptionLocalizations({ 'pt-BR': 'Ninguém novo pode entrar' }),
    )
    .addSubcommand((sub) =>
      sub
        .setName('unlock')
        .setDescription('Open the room again')
        .setDescriptionLocalizations({ 'pt-BR': 'Abre a sala de novo' }),
    )
    .addSubcommand((sub) =>
      sub
        .setName('hide')
        .setDescription('Hide the room from the channel list; people inside still see it')
        .setDescriptionLocalizations({
          'pt-BR': 'Esconde a sala da lista; quem está nela continua vendo',
        }),
    )
    .addSubcommand((sub) =>
      sub
        .setName('unhide')
        .setDescription('Show the room in the channel list again')
        .setDescriptionLocalizations({ 'pt-BR': 'Mostra a sala na lista de novo' }),
    )
    .addSubcommand((sub) =>
      sub
        .setName('kick')
        .setDescription('Remove someone from the room; they cannot rejoin it')
        .setDescriptionLocalizations({
          'pt-BR': 'Remove alguém da sala; a pessoa não consegue voltar',
        })
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('claim')
        .setDescription('Become the owner of a room whose owner left')
        .setDescriptionLocalizations({ 'pt-BR': 'Vira dono de uma sala cujo dono saiu' }),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const command: RoomCommand =
      sub === 'rename'
        ? { type: 'rename', name: interaction.options.getString('name', true) }
        : sub === 'limit'
          ? { type: 'limit', limit: interaction.options.getInteger('limit', true) }
          : sub === 'kick'
            ? { type: 'kick', userId: interaction.options.getUser('user', true).id }
            : { type: sub as 'lock' | 'unlock' | 'hide' | 'unhide' | 'claim' };

    // Channel edits can be slow (Discord rate-limits renames), so answer within 3s first.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await ctx.guild.members.fetch(interaction.user.id);
    const actor = await ctx.resolveActor(interaction.user.id);

    await runWithConfirmation(interaction, ctx.confirmations, () =>
      ctx.voice.manage(actor, member.voice.channelId, command),
    );
  },
};
