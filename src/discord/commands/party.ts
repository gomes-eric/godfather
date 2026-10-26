import { MessageFlags, SlashCommandBuilder, type ButtonInteraction } from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import type { PartyAction } from '../../services/party.service.js';
import { outcomeMessage } from '../interactions/confirmation.js';
import { PARTY_PREFIX } from '../party-card.js';
import type { CommandContext, SlashCommand } from './types.js';

const t = ptBR.party;
const ACTIONS = new Set<PartyAction>(['join', 'leave', 'close']);

export const partyCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('party')
    .setDescription('Open a group for a dungeon, boss or Abyss run; others join with a button')
    .setDescriptionLocalizations({
      'pt-BR': 'Abre um grupo para masmorra, boss ou Abismo; a galera entra pelo botão',
    })
    .addStringOption((o) =>
      o
        .setName('activity')
        .setDescription('What the group is for, e.g. "Krao Cave (Hard)"')
        .setDescriptionLocalizations({
          'pt-BR': 'Para que é o grupo, ex.: "Caverna de Krao (Difícil)"',
        })
        .setMaxLength(100)
        .setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName('slots')
        .setDescription('How many people, you included (2-24)')
        .setDescriptionLocalizations({ 'pt-BR': 'Quantas pessoas, contando você (2 a 24)' })
        .setMinValue(2)
        .setMaxValue(24)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName('when')
        .setDescription('When it starts, e.g. "21h" or "now"')
        .setDescriptionLocalizations({ 'pt-BR': 'Quando começa, ex.: "21h" ou "agora"' })
        .setMaxLength(50),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const activity = interaction.options.getString('activity', true).trim();
    const slots = interaction.options.getInteger('slots', true);
    const startsAt = interaction.options.getString('when')?.trim() || null;
    const channel = interaction.channel;
    if (!channel?.isSendable()) {
      await interaction.reply({ content: `⚠️ ${t.noChannel}`, flags: MessageFlags.Ephemeral });
      return;
    }

    const actor = await ctx.resolveActor(interaction.user.id);
    const outcome = await ctx.parties.create(actor, {
      channelId: channel.id,
      activity,
      slots,
      startsAt,
    });
    if (outcome.status !== 'ok') {
      await interaction.reply({
        content:
          outcome.status === 'confirmation_required' ? outcome.preview : outcomeMessage(outcome),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // The card is the command's public reply, so it shows who opened the group.
    const reply = await interaction.reply({
      ...ctx.parties.card(outcome.value),
      allowedMentions: { parse: [] },
      withResponse: true,
    });
    const message = reply.resource?.message;
    if (message) ctx.parties.attachMessage(outcome.value, message.id);
  },
};

/** Entrar / Sair / Fechar on a party card. Returns false for any other button. */
export async function handlePartyButton(
  interaction: ButtonInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (!interaction.customId.startsWith(PARTY_PREFIX)) return false;
  const [action, rawId] = interaction.customId.slice(PARTY_PREFIX.length).split(':');
  const partyId = Number(rawId);
  if (!ACTIONS.has(action as PartyAction) || !Number.isInteger(partyId)) return false;

  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.parties.act(actor, partyId, action as PartyAction);
  if (outcome.status !== 'ok') {
    await interaction.reply({
      content:
        outcome.status === 'confirmation_required' ? outcome.preview : outcomeMessage(outcome),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const { party, justFilled } = outcome.value;
  await interaction.update({ ...ctx.parties.card(party), allowedMentions: { parse: [] } });
  if (justFilled && interaction.channel?.isSendable()) {
    const ids = ctx.parties.view(party).members.map((m) => m.id);
    await interaction.channel.send({
      content: t.filled(party.activity, ids),
      allowedMentions: { users: ids },
    });
  }
  return true;
}
