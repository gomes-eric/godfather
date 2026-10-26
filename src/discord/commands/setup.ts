import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { formatPlan, formatResult } from '../../setup/format.js';
import { COLORS } from '../colors.js';
import { runWithConfirmation } from '../interactions/confirmation.js';
import { failureText } from '../replies.js';
import type { SlashCommand } from './types.js';

const EMBED_LIMIT = 3900;
const PROMPT_LIMIT = 1500;

export const setupCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Apply server.yaml to the server (channels, roles, permissions, panels)')
    .setDescriptionLocalizations({
      'pt-BR': 'Aplica o server.yaml no servidor (canais, cargos, permissões, painéis)',
    })
    .addBooleanOption((option) =>
      option
        .setName('dry-run')
        .setDescription('Only show what would change')
        .setDescriptionLocalizations({ 'pt-BR': 'Só mostra o que mudaria' }),
    )
    .addBooleanOption((option) =>
      option
        .setName('prune')
        .setDescription('Also delete managed items that were removed from server.yaml')
        .setDescriptionLocalizations({
          'pt-BR': 'Também apaga itens gerenciados que saíram do server.yaml',
        }),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const dryRun = interaction.options.getBoolean('dry-run') ?? false;
    const prune = interaction.options.getBoolean('prune') ?? false;
    const actor = await ctx.resolveActor(interaction.user.id);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const planned = await ctx.runAction({
      actor,
      action: 'setup.plan',
      preview: 'setup.plan',
      execute: () => ctx.setup.plan(prune),
    });
    if (planned.status !== 'ok') {
      await interaction.editReply(failureText(planned));
      return;
    }

    const { plan } = planned.value;
    if (dryRun || plan.ops.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle(ptBR.setup.previewTitle)
        .setColor(COLORS.brand)
        .setDescription(formatPlan(plan, EMBED_LIMIT));
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const summary = ptBR.setup.counts(plan.ops.length);
    await runWithConfirmation(interaction, ctx.confirmations, (confirm) =>
      ctx.runAction({
        actor,
        action: 'setup.apply',
        confirm,
        target: 'server.yaml',
        params: { prune, ops: plan.ops.length, warnings: plan.warnings.length },
        preview: `${ptBR.setup.confirmPreview(summary)}\n\n${formatPlan(plan, PROMPT_LIMIT)}`,
        // Re-plan at click time: the guild may have changed while the prompt was open.
        execute: async () => {
          const fresh = await ctx.setup.plan(prune);
          const result = await ctx.setup.apply(fresh);
          ctx.logger.info(
            { applied: result.applied.length, failures: result.failures },
            'setup applied',
          );
          return formatResult(fresh.plan, result, PROMPT_LIMIT);
        },
      }),
    );
  },
};
