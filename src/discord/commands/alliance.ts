import { SlashCommandBuilder, type SlashCommandStringOption } from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { runWithConfirmation } from '../interactions/confirmation.js';
import { failureText, listEmbed, replyPrivately } from '../replies.js';
import type { SlashCommand } from './types.js';

const t = ptBR.alliances;

const legionOption =
  (description: string, ptDescription: string) => (o: SlashCommandStringOption) =>
    o
      .setName('legion')
      .setDescription(description)
      .setDescriptionLocalizations({ 'pt-BR': ptDescription })
      .setMaxLength(100)
      .setRequired(true);

export const allianceCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('alliance')
    .setDescription('Allied legions')
    .setDescriptionLocalizations({ 'pt-BR': 'Legiões aliadas' })
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Ally with a legion: creates its role')
        .setDescriptionLocalizations({ 'pt-BR': 'Cria uma aliança com uma legião e o cargo dela' })
        .addStringOption(
          legionOption(
            'Legion name, exactly as in the game',
            'Nome da legião, exatamente como no jogo',
          ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('End an alliance: its allies become Restrito')
        .setDescriptionLocalizations({
          'pt-BR': 'Desfaz uma aliança: os aliados dela viram Restrito',
        })
        .addStringOption(legionOption('The allied legion', 'A legião aliada')),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('leader')
        .setDescription('Leaders of the allied guilds (the Líder Aliado role)')
        .setDescriptionLocalizations({
          'pt-BR': 'Líderes das guildas aliadas (cargo Líder Aliado)',
        })
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Mark an ally as a leader of their guild')
            .setDescriptionLocalizations({ 'pt-BR': 'Marca um Aliado como líder da guilda dele' })
            .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)),
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Take the Líder Aliado role back')
            .setDescriptionLocalizations({ 'pt-BR': 'Tira o cargo Líder Aliado' })
            .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('The allied legions and how many allies each has')
        .setDescriptionLocalizations({ 'pt-BR': 'As alianças e quantos aliados cada uma tem' }),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const actor = await ctx.resolveActor(interaction.user.id);

    if (interaction.options.getSubcommandGroup() === 'leader') {
      const user = interaction.options.getUser('user', true);
      await runWithConfirmation(interaction, ctx.confirmations, () =>
        ctx.roster.setAllyLeader(actor, user.id, sub === 'add'),
      );
      return;
    }

    if (sub === 'add') {
      const legion = interaction.options.getString('legion', true);
      await runWithConfirmation(interaction, ctx.confirmations, () =>
        ctx.alliances.add(actor, legion),
      );
      return;
    }
    if (sub === 'remove') {
      const legion = interaction.options.getString('legion', true);
      await runWithConfirmation(interaction, ctx.confirmations, (confirm) =>
        ctx.alliances.remove(actor, legion, confirm),
      );
      return;
    }

    const outcome = await ctx.alliances.list(actor);
    if (outcome.status !== 'ok') {
      await replyPrivately(interaction, failureText(outcome));
      return;
    }
    const lines = outcome.value.map((a) => t.listLine(a.legion, a.members) + t.leaders(a.leaders));
    await replyPrivately(interaction, { embeds: [listEmbed(t.listTitle, lines, t.listEmpty)] });
  },
};
