import type { ButtonInteraction } from 'discord.js';
import type { PartyAction } from '../../services/party.service.js';
import type { CommandContext } from '../commands/types.js';
import { numericPart, parseCustomId } from '../custom-id.js';
import { PARTY_PREFIX, partyCard } from '../party-card.js';
import { failureText, replyPrivately } from '../replies.js';

const ACTIONS = new Set<string>(['join', 'leave', 'close'] satisfies PartyAction[]);

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

  const { view, filled } = outcome.value;
  await interaction.update({ ...partyCard(view), allowedMentions: { parse: [] } });
  if (filled && interaction.channel?.isSendable()) {
    await interaction.channel.send({
      content: filled.text,
      allowedMentions: { users: filled.mentionIds },
    });
  }
  return true;
}
