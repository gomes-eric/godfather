import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type SlashCommandStringOption,
} from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { outcomeMessage } from '../interactions/confirmation.js';
import type { SlashCommand } from './types.js';

const t = ptBR.bosses;

const bossOption = (o: SlashCommandStringOption) =>
  o
    .setName('boss')
    .setDescription('Boss name or key, e.g. "gartua", "lagta"')
    .setDescriptionLocalizations({ 'pt-BR': 'Nome ou chave do boss, ex.: "gartua", "lagta"' })
    .setRequired(true);

export const bossCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('boss')
    .setDescription('Respawn timers of the daily field bosses')
    .setDescriptionLocalizations({ 'pt-BR': 'Timers de respawn dos bosses de campo' })
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Next respawns and where the time came from')
        .setDescriptionLocalizations({ 'pt-BR': 'Próximos respawns e de onde veio o horário' }),
    )
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set the respawn by hand (wins over questlog.gg until it happens)')
        .setDescriptionLocalizations({
          'pt-BR': 'Define o respawn à mão (vale mais que o questlog.gg até acontecer)',
        })
        .addStringOption(bossOption)
        .addStringOption((o) =>
          o
            .setName('time')
            .setDescription('"09:16" (clock on the map) or "5h44m" (time left)')
            .setDescriptionLocalizations({
              'pt-BR': '"09:16" (relógio do mapa) ou "5h44m" (tempo restante)',
            })
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('killed')
        .setDescription('We just killed it (needs respawnMinutes in server.yaml)')
        .setDescriptionLocalizations({
          'pt-BR': 'Acabamos de matar (precisa de respawnMinutes no server.yaml)',
        })
        .addStringOption(bossOption),
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Drop the manual time and go back to questlog.gg')
        .setDescriptionLocalizations({
          'pt-BR': 'Remove o horário manual e volta a usar o questlog.gg',
        })
        .addStringOption(bossOption),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const actor = await ctx.resolveActor(interaction.user.id);

    if (sub === 'list') {
      const outcome = await ctx.runAction({
        actor,
        action: 'boss.read',
        preview: 'boss.read',
        execute: async () => ctx.bosses.status().map((status) => ctx.bosses.describe(status)),
      });
      if (outcome.status !== 'ok') {
        const content =
          outcome.status === 'confirmation_required' ? outcome.preview : outcomeMessage(outcome);
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        return;
      }
      const lines = [...outcome.value, ...(ctx.bosses.feedEnabled() ? [] : ['', t.feedOff])];
      const embed = new EmbedBuilder()
        .setTitle(t.listTitle)
        .setColor(0xe0303a)
        .setDescription(lines.join('\n'));
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const boss = interaction.options.getString('boss', true);
    const outcome =
      sub === 'set'
        ? await ctx.bosses.set(actor, boss, interaction.options.getString('time', true))
        : sub === 'killed'
          ? await ctx.bosses.killed(actor, boss)
          : await ctx.bosses.clear(actor, boss);
    const content =
      outcome.status === 'confirmation_required' ? outcome.preview : outcomeMessage(outcome);
    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};
