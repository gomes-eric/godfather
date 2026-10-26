import type { ButtonInteraction } from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import type { PartyAction } from '../../services/party.service.js';
import type { CommandContext } from '../commands/types.js';
import { numericPart, parseCustomId } from '../custom-id.js';
import { PARTY_PREFIX } from '../party-card.js';
import { failureText, replyPrivately } from '../replies.js';

const ACTIONS = new Set<string>(['join', 'leave', 'close'] satisfies PartyAction[]);

/** Entrar / Sair / Fechar on a party card. Returns false for any other button. */
export async function handlePartyButton(
  interaction: ButtonInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  const [action, rawId] = parseCustomId(interaction.customId, PARTY_PREFIX) ?? [];
  const partyId = numericPart(rawId);
  if (!action || !ACTIONS.has(action) || partyId === undefined) return false;

  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.parties.act(actor, partyId, action as PartyAction);
  if (outcome.status !== 'ok') {
    await replyPrivately(interaction, failureText(outcome));
    return true;
  }

  const { party, justFilled } = outcome.value;
  await interaction.update({ ...ctx.parties.card(party), allowedMentions: { parse: [] } });
  if (justFilled && interaction.channel?.isSendable()) {
    const ids = ctx.parties.view(party).members.map((m) => m.id);
    await interaction.channel.send({
      content: ptBR.party.filled(party.activity, ids),
      allowedMentions: { users: ids },
    });
  }
  return true;
}
