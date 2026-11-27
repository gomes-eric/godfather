import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import type { RoomCommand } from '../../services/voice.service.js';
import type { CommandContext } from '../commands/types.js';
import { customId } from '../custom-id.js';
import { outcomeText, replyPrivately } from '../replies.js';
import {
  parsePanelCustomId,
  ROOM_KICK_PREFIX,
  ROOM_MODAL_PREFIX,
  ROOM_PREFIX,
} from '../room-panel.js';

const t = ptBR.voice;
const DIRECT = new Set(['lock', 'unlock', 'hide', 'unhide', 'claim']);
/** A select menu holds at most 25 options. */
const MAX_KICK_OPTIONS = 25;

type Repliable = ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction;

async function run(
  interaction: Repliable,
  ctx: CommandContext,
  roomId: string,
  command: RoomCommand,
): Promise<void> {
  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.voice.manage(actor, roomId, command);
  await interaction.editReply({ content: outcomeText(outcome), components: [] });
}

function textModal(roomId: string, action: 'rename' | 'limit', value: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId('value')
    .setRequired(true)
    .setValue(value)
    .setStyle(TextInputStyle.Short);
  if (action === 'rename') input.setLabel(t.panel.renameLabel).setMinLength(1).setMaxLength(100);
  else input.setLabel(t.panel.limitLabel).setMinLength(1).setMaxLength(2);

  return new ModalBuilder()
    .setCustomId(customId(ROOM_MODAL_PREFIX, action, roomId))
    .setTitle(action === 'rename' ? t.panel.renameTitle : t.panel.limitTitle)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

function kickPicker(roomId: string, occupants: ReturnType<CommandContext['voice']['occupants']>) {
  const picker = new StringSelectMenuBuilder()
    .setCustomId(customId(ROOM_KICK_PREFIX, 'kick', roomId))
    .setPlaceholder(t.panel.kickPlaceholder)
    .addOptions(
      occupants.slice(0, MAX_KICK_OPTIONS).map((member) => ({
        label: member.displayName.slice(0, 100),
        description: member.user.username.slice(0, 100),
        value: member.id,
      })),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(picker);
}

export async function handleRoomPanelButton(
  interaction: ButtonInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  const parsed = parsePanelCustomId(interaction.customId, ROOM_PREFIX);
  if (!parsed) return false;
  const { action, roomId } = parsed;

  if (DIRECT.has(action)) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await run(interaction, ctx, roomId, { type: action as 'lock' | 'unlock' | 'claim' });
    return true;
  }
  if (action !== 'rename' && action !== 'limit' && action !== 'kick') return false;

  const actor = await ctx.resolveActor(interaction.user.id);
  const refusal = ctx.voice.refusal(actor, roomId, action);
  if (refusal) {
    await replyPrivately(interaction, `⚠️ ${refusal}`);
    return true;
  }

  if (action === 'kick') {
    const occupants = ctx.voice.occupants(roomId, interaction.user.id);
    await replyPrivately(
      interaction,
      occupants.length === 0
        ? `⚠️ ${t.nobodyToKick}`
        : { content: t.kickPrompt, components: [kickPicker(roomId, occupants)] },
    );
    return true;
  }

  const channel = interaction.guild?.channels.cache.get(roomId);
  const current =
    action === 'rename'
      ? (channel?.name ?? '')
      : String(channel && 'userLimit' in channel ? channel.userLimit : 0);
  await interaction.showModal(textModal(roomId, action, current));
  return true;
}

export async function handleRoomPanelModal(
  interaction: ModalSubmitInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  const parsed = parsePanelCustomId(interaction.customId, ROOM_MODAL_PREFIX);
  if (!parsed) return false;
  const { action, roomId } = parsed;
  if (action !== 'rename' && action !== 'limit') return false;
  const value = interaction.fields.getTextInputValue('value').trim();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const command: RoomCommand =
    action === 'rename'
      ? { type: 'rename', name: value }
      : { type: 'limit', limit: /^\d{1,2}$/.test(value) ? Number(value) : Number.NaN };
  await run(interaction, ctx, roomId, command);
  return true;
}

export async function handleRoomKickSelect(
  interaction: StringSelectMenuInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  const parsed = parsePanelCustomId(interaction.customId, ROOM_KICK_PREFIX);
  const userId = interaction.values[0];
  if (!parsed || !userId) return false;

  await interaction.deferUpdate();
  await run(interaction, ctx, parsed.roomId, { type: 'kick', userId });
  return true;
}
