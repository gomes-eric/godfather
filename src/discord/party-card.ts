import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { ptBR } from '../i18n/pt-BR.js';

const t = ptBR.party;
/** Buttons are `party:<join|leave|close>:<partyId>`. */
export const PARTY_PREFIX = 'party:';
const COLORS = { open: 0x4fb286, full: 0xd9b45a, closed: 0x6e7f99 };

export interface PartyView {
  id: number;
  activity: string;
  startsAt: string | null;
  ownerId: string;
  slots: number;
  closed: boolean;
  /** In join order, each with the emoji of their class (or a neutral one). */
  members: { id: string; emoji: string }[];
}

export function partyCustomId(action: 'join' | 'leave' | 'close', id: number): string {
  return `${PARTY_PREFIX}${action}:${id}`;
}

/** The party card: who is in, free slots, and Entrar/Sair/Fechar while it is open. */
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
    .setColor(COLORS[state])
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
      .setCustomId(partyCustomId('join', view.id))
      .setLabel(t.join)
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(full),
    new ButtonBuilder()
      .setCustomId(partyCustomId('leave', view.id))
      .setLabel(t.leave)
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(partyCustomId('close', view.id))
      .setLabel(t.close)
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}
