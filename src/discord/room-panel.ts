import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { RoomAccess } from '../core/voice-rooms.js';
import { ptBR } from '../i18n/pt-BR.js';
import { COLORS } from './colors.js';
import { customId, parseCustomId } from './custom-id.js';

const t = ptBR.voice.panel;

/** Buttons are `room:<action>:<roomId>`; the room id rides along so a click names its room. */
export const ROOM_PREFIX = 'room:';
/** Modals (rename, limit) and the kick picker the buttons open. */
export const ROOM_MODAL_PREFIX = 'room-modal:';
export const ROOM_KICK_PREFIX = 'room-kick:';

export type PanelAction =
  'lock' | 'unlock' | 'hide' | 'unhide' | 'limit' | 'rename' | 'kick' | 'claim';

export interface RoomPanelView extends RoomAccess {
  roomId: string;
  ownerId: string;
  userLimit: number;
}

/** `room:lock:123` → { action: 'lock', roomId: '123' }; anything else → undefined. */
export function parsePanelCustomId(
  id: string,
  prefix: string,
): { action: string; roomId: string } | undefined {
  const [action, roomId] = parseCustomId(id, prefix) ?? [];
  return action && roomId ? { action, roomId } : undefined;
}

function button(action: PanelAction, roomId: string, emoji: string, label: string) {
  return new ButtonBuilder()
    .setCustomId(customId(ROOM_PREFIX, action, roomId))
    .setEmoji(emoji)
    .setLabel(label)
    .setStyle(ButtonStyle.Secondary);
}

/**
 * The control panel posted in a temp room's chat. It follows the room: the privacy buttons show
 * the action available now, and the description names the current owner and mode. Everyone in
 * the room sees the same buttons; who may press them is checked on click.
 */
export function roomPanel(view: RoomPanelView): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const state = [
    view.locked ? t.lockedState : t.open,
    view.hidden ? t.hiddenState : t.visible,
    t.limit(view.userLimit),
  ].join(' · ');

  const embed = new EmbedBuilder()
    .setColor(COLORS.violet)
    .setTitle(t.title)
    .setDescription([t.owner(view.ownerId), state, '', t.help].join('\n'));

  const { roomId } = view;
  const privacy = new ActionRowBuilder<ButtonBuilder>().addComponents(
    view.locked ? button('unlock', roomId, '🔓', t.unlock) : button('lock', roomId, '🔒', t.lock),
    view.hidden ? button('unhide', roomId, '👁️', t.unhide) : button('hide', roomId, '🙈', t.hide),
    button('limit', roomId, '👥', t.setLimit),
  );
  const people = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button('rename', roomId, '✏️', t.rename),
    button('kick', roomId, '👢', t.kick),
    button('claim', roomId, '👑', t.claim),
  );
  return { embeds: [embed], components: [privacy, people] };
}
