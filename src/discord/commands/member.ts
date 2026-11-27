import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { unixSeconds } from '../../core/schedule.js';
import type { Tier } from '../../core/tiers.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { COLORS } from '../colors.js';
import { runWithConfirmation } from '../interactions/confirmation.js';
import { failureText, replyPrivately } from '../replies.js';
import type { SlashCommand } from './types.js';

const rankChoices = (tiers: Tier[]) =>
  tiers.map((tier) => ({ name: ptBR.tier(tier), value: tier }));

export const memberCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('member')
    .setDescription('Manage legion members')
    .setDescriptionLocalizations({ 'pt-BR': 'Gerencia os membros da legião' })
    .addSubcommand((sub) =>
      sub
        .setName('promote')
        .setDescription('Promote a member (Visitante → Soldado → Oficial)')
        .setDescriptionLocalizations({
          'pt-BR': 'Promove um membro (Visitante → Soldado → Oficial)',
        })
        .addUserOption((o) => o.setName('user').setDescription('Who to promote').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('rank')
            .setDescription('Target rank (default: one step up)')
            .addChoices(...rankChoices(['soldier', 'officer', 'commander'])),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('demote')
        .setDescription('Demote a member one step (or to a given rank)')
        .setDescriptionLocalizations({ 'pt-BR': 'Rebaixa um membro um nível (ou para um cargo)' })
        .addUserOption((o) => o.setName('user').setDescription('Who to demote').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('rank')
            .setDescription('Target rank (default: one step down)')
            .addChoices(...rankChoices(['visitor', 'soldier', 'officer'])),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('partner')
        .setDescription('Make someone who does not play a Parceiro (or take it back)')
        .setDescriptionLocalizations({
          'pt-BR':
            'Torna Parceiro alguém que não joga, tirando o cargo anterior (ou tira o Parceiro)',
        })
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addBooleanOption((o) =>
          o
            .setName('remove')
            .setDescription('Take Parceiro away and go back to Visitante')
            .setDescriptionLocalizations({ 'pt-BR': 'Tira o Parceiro e volta para Visitante' }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('ally')
        .setDescription('Make someone an ally of an existing alliance')
        .setDescriptionLocalizations({
          'pt-BR': 'Torna alguém Aliado de uma aliança, tirando o cargo anterior',
        })
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('legion')
            .setDescription('The allied legion, as in /alliance list')
            .setDescriptionLocalizations({ 'pt-BR': 'A legião aliada, como em /alliance list' })
            .setMaxLength(100)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('restrict')
        .setDescription('Restrict someone to #geral (any of the existing commands lifts it)')
        .setDescriptionLocalizations({
          'pt-BR': 'Restringe alguém ao #geral (promote, partner ou ally tiram o Restrito)',
        })
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('reason')
            .setDescription('Why (shown to the officers)')
            .setDescriptionLocalizations({ 'pt-BR': 'Motivo (aparece para os oficiais)' })
            .setMaxLength(300)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('info')
        .setDescription('Show a member’s rank, classes and dates')
        .setDescriptionLocalizations({ 'pt-BR': 'Mostra cargo, classes e datas de um membro' })
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user', true);
    const rank = (interaction.options.getString('rank') ?? undefined) as Tier | undefined;
    const actor = await ctx.resolveActor(interaction.user.id);

    if (sub === 'promote') {
      await runWithConfirmation(interaction, ctx.confirmations, () =>
        ctx.roster.promote(actor, user.id, rank),
      );
      return;
    }
    if (sub === 'partner') {
      const remove = interaction.options.getBoolean('remove') ?? false;
      await runWithConfirmation(interaction, ctx.confirmations, () =>
        ctx.roster.partner(actor, user.id, remove),
      );
      return;
    }
    if (sub === 'ally') {
      const legion = interaction.options.getString('legion', true);
      await runWithConfirmation(interaction, ctx.confirmations, () =>
        ctx.roster.ally(actor, user.id, legion),
      );
      return;
    }
    if (sub === 'restrict') {
      const reason = interaction.options.getString('reason', true);
      await runWithConfirmation(interaction, ctx.confirmations, () =>
        ctx.roster.restrict(actor, user.id, reason),
      );
      return;
    }
    if (sub === 'demote') {
      await runWithConfirmation(interaction, ctx.confirmations, (confirm) =>
        ctx.roster.demote(actor, user.id, rank, confirm),
      );
      return;
    }

    const outcome = await ctx.roster.info(actor, user.id);
    if (outcome.status !== 'ok') {
      await replyPrivately(interaction, failureText(outcome));
      return;
    }

    const info = outcome.value;
    const f = ptBR.members.info;
    const ts = (date: Date | null) => (date ? `<t:${unixSeconds(date)}:D>` : f.none);
    const embed = new EmbedBuilder()
      .setTitle(f.title(info.name))
      .setThumbnail(info.avatarUrl)
      .setColor(COLORS.brand)
      .addFields(
        { name: f.tier, value: info.standing, inline: true },
        { name: f.classes, value: info.classes.join(', ') || f.none, inline: true },
        { name: f.joined, value: ts(info.joinedAt), inline: true },
        { name: f.created, value: ts(info.createdAt), inline: true },
      );
    if (info.timeoutUntil) {
      embed.addFields({
        name: f.timedOut,
        value: `<t:${unixSeconds(info.timeoutUntil)}:f>`,
        inline: true,
      });
    }
    await replyPrivately(interaction, { embeds: [embed] });
  },
};
