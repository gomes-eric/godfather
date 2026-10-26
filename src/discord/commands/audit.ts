import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { AuditResult } from '../../core/audit.js';
import { unixSeconds } from '../../core/schedule.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { COLORS } from '../colors.js';
import { failureText, replyPrivately } from '../replies.js';
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
      await replyPrivately(interaction, failureText(outcome));
      return;
    }

    const lines = outcome.value.map((row) => {
      const target = row.target ? ` → ${row.target}` : '';
      return `<t:${unixSeconds(row.at)}:R> · \`${row.action}\`${target} · <@${row.actorId}> · ${ptBR.audit.result(row.result as AuditResult)}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(ptBR.audit.listTitle)
      .setColor(COLORS.brand)
      .setDescription(lines.length > 0 ? lines.join('\n') : ptBR.audit.empty);

    await replyPrivately(interaction, { embeds: [embed], allowedMentions: { parse: [] } });
  },
};
