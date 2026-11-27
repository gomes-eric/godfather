import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { PartyView } from '../services/party.service.js';
import { COLORS } from './colors.js';
import { customId } from './custom-id.js';

const t = ptBR.party;
export const PARTY_PREFIX = 'party:';
const STATE_COLORS = { open: COLORS.green, full: COLORS.gold, closed: COLORS.slate };

export function partyCard(view: PartyView): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const full = view.members.length >= view.slots;
  const state = view.closed ? 'closed' : full ? 'full' : 'open';
  const lines = Array.from({ length: view.slots }, (_, i) => {
    const member = view.members[i];
    return member ? `\`${i + 1}.\` ${member.emoji} <@${member.id}>` : `\`${i + 1}.\` ${t.freeSlot}`;
  });

  const embed = new EmbedBuilder()
    .setColor(STATE_COLORS[state])
    .setTitle(`${t.stateEmoji[state]} ${view.activity}`.slice(0, 256))
    .setDescription(
      [
        ...(view.startsAt ? [t.when(view.startsAt)] : []),
        t.leader(view.ownerId),
        t.state[state],
      ].join('\n'),
    )
    .addFields({
      name: t.slots(view.members.length, view.slots),
      value: lines.join('\n').slice(0, 1024),
    })
    .setFooter({ text: view.closed ? t.footerClosed : t.footer(view.id) });

  if (view.closed) return { embeds: [embed], components: [] };
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(PARTY_PREFIX, 'join', view.id))
      .setLabel(t.join)
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(full),
    new ButtonBuilder()
      .setCustomId(customId(PARTY_PREFIX, 'leave', view.id))
      .setLabel(t.leave)
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(customId(PARTY_PREFIX, 'close', view.id))
      .setLabel(t.close)
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}
