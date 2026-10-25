import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { AuditResult } from '../../core/audit.js';
import { ptBR } from '../../i18n/pt-BR.js';
import type { SlashCommand } from './types.js';

const DEFAULT_LIMIT = 10;

export const auditCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('audit')
    .setDescription('Show the most recent actions recorded in the audit log')
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra as ações mais recentes da auditoria' })
    .addIntegerOption((option) =>
      option
        .setName('limit')
        .setDescription('How many entries to show (1-25)')
        .setDescriptionLocalizations({ 'pt-BR': 'Quantos registros mostrar (1-25)' })
        .setMinValue(1)
        .setMaxValue(25),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const limit = interaction.options.getInteger('limit') ?? DEFAULT_LIMIT;
    const actor = await ctx.resolveActor(interaction.user.id);

    const outcome = await ctx.runAction({
      actor,
      action: 'audit.read',
      preview: `audit.read limit=${limit}`,
      execute: async () => ctx.audit.recent(limit),
    });

    if (outcome.status !== 'ok') {
      const content =
        outcome.status === 'denied' ? ptBR.errors.denied(outcome.requiredTier) : outcome.preview;
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = outcome.value.map((row) => {
      const at = Math.floor(row.at.getTime() / 1000);
      const target = row.target ? ` → ${row.target}` : '';
      return `<t:${at}:R> · \`${row.action}\`${target} · <@${row.actorId}> · ${ptBR.audit.result(row.result as AuditResult)}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(ptBR.audit.listTitle)
      .setColor(0xa855f7)
      .setDescription(lines.length > 0 ? lines.join('\n') : ptBR.audit.empty);

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};
