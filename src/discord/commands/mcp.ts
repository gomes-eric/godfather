import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { outcomeMessage } from '../interactions/confirmation.js';
import type { SlashCommand } from './types.js';

const t = ptBR.mcp;
const unix = (date: Date) => Math.floor(date.getTime() / 1000);

export const mcpCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('mcp')
    .setDescription('Personal tokens to control Padrinho from an AI assistant')
    .setDescriptionLocalizations({ 'pt-BR': 'Tokens pessoais para controlar o Padrinho por IA' })
    .addSubcommandGroup((group) =>
      group
        .setName('token')
        .setDescription('Manage your MCP tokens')
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Create a token (shown once)')
            .setDescriptionLocalizations({ 'pt-BR': 'Cria um token (mostrado uma vez)' })
            .addStringOption((o) =>
              o
                .setName('name')
                .setDescription('Where you will use it, e.g. "laptop"')
                .setDescriptionLocalizations({ 'pt-BR': 'Onde vai usar, ex.: "notebook"' })
                .setMaxLength(50)
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('list')
            .setDescription('Your active tokens')
            .setDescriptionLocalizations({ 'pt-BR': 'Seus tokens ativos' }),
        )
        .addSubcommand((sub) =>
          sub
            .setName('revoke')
            .setDescription('Revoke a token')
            .setDescriptionLocalizations({ 'pt-BR': 'Revoga um token' })
            .addIntegerOption((o) =>
              o.setName('id').setDescription('Token number (see list)').setRequired(true),
            ),
        ),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const actor = await ctx.resolveActor(interaction.user.id);

    if (sub === 'create') {
      const outcome = await ctx.tokens.create(actor, interaction.options.getString('name', true));
      const content =
        outcome.status === 'ok'
          ? t.created(interaction.options.getString('name', true), outcome.value.token, ctx.mcpUrl)
          : outcome.status === 'confirmation_required'
            ? outcome.preview
            : outcomeMessage(outcome);
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'revoke') {
      const outcome = await ctx.tokens.revoke(actor, interaction.options.getInteger('id', true));
      const content =
        outcome.status === 'confirmation_required' ? outcome.preview : outcomeMessage(outcome);
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }

    const rows = ctx.tokens.list(interaction.user.id);
    const embed = new EmbedBuilder()
      .setTitle(t.listTitle)
      .setColor(0xa855f7)
      .setDescription(
        rows
          .map((row) =>
            t.listLine(
              row.id,
              row.name,
              unix(row.createdAt),
              row.lastUsedAt ? unix(row.lastUsedAt) : null,
            ),
          )
          .join('\n') || t.none,
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
