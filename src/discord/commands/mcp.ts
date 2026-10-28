import { SlashCommandBuilder } from 'discord.js';
import { unixSeconds as unix } from '../../core/schedule.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { failureText, listEmbed, outcomeText, replyPrivately } from '../replies.js';
import type { SlashCommand } from './types.js';

const t = ptBR.mcp;

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
      const name = interaction.options.getString('name', true);
      const outcome = await ctx.tokens.create(actor, name);
      await replyPrivately(
        interaction,
        outcome.status === 'ok'
          ? t.created(name, outcome.value.token, ctx.mcpUrl)
          : failureText(outcome),
      );
      return;
    }

    if (sub === 'revoke') {
      const outcome = await ctx.tokens.revoke(actor, interaction.options.getInteger('id', true));
      await replyPrivately(interaction, outcomeText(outcome));
      return;
    }

    const rows = ctx.tokens.list(interaction.user.id);
    const lines = rows.map((row) =>
      t.listLine(
        row.id,
        row.name,
        unix(row.createdAt),
        row.lastUsedAt ? unix(row.lastUsedAt) : null,
      ),
    );
    const embed = listEmbed(t.listTitle, lines, t.none);
    await replyPrivately(interaction, { embeds: [embed] });
  },
};
