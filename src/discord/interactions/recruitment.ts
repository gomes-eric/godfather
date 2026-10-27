import { MessageFlags, type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
import { normalizeGameName } from '../../core/registration.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { GameApiError } from '../../services/game-character.service.js';
import { RECRUIT_APPLY_ID } from '../../setup/desired.js';
import type { CommandContext } from '../commands/types.js';
import { numericPart, parseCustomId } from '../custom-id.js';
import {
  applicationModal,
  RECRUIT_DECIDE_PREFIX,
  RECRUIT_FIELDS,
  RECRUIT_MODAL_ID,
} from '../recruitment.js';
import { failureText, replyPrivately } from '../replies.js';

const t = ptBR.recruitment;

/** "Enviar minha ficha": opens the form, unless they are in already or wait for a decision. */
async function openApplication(interaction: ButtonInteraction, ctx: CommandContext) {
  const actor = await ctx.resolveActor(interaction.user.id);
  const problem =
    actor.tier !== 'visitor'
      ? t.alreadyMember
      : ctx.applications.pendingFor(actor.userId)
        ? t.alreadyPending
        : null;
  if (problem) {
    await replyPrivately(interaction, `⚠️ ${problem}`);
    return;
  }
  await interaction.showModal(applicationModal(ctx.registrations.get(actor.userId)?.name));
}

/** "Enviar minha ficha" and the officers' Aprovar/Recusar. Returns false for other buttons. */
export async function handleRecruitButton(
  interaction: ButtonInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (!ctx.config.get().settings.recruitment) return false;

  if (interaction.customId === RECRUIT_APPLY_ID) {
    await openApplication(interaction, ctx);
    return true;
  }

  const [action, rawId] = parseCustomId(interaction.customId, RECRUIT_DECIDE_PREFIX) ?? [];
  const id = numericPart(rawId);
  if ((action !== 'approve' && action !== 'reject') || id === undefined) return false;

  // Registering can take a few seconds; the desk updates the card itself once it is decided.
  await interaction.deferUpdate();
  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.recruitmentDesk.decide(actor, id, action === 'approve');
  if (outcome.status !== 'ok') {
    await interaction.followUp({ content: failureText(outcome), flags: MessageFlags.Ephemeral });
  }
  return true;
}

/** The submitted application: checks the character on the official site and tells the officers. */
export async function handleRecruitModal(
  interaction: ModalSubmitInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (interaction.customId !== RECRUIT_MODAL_ID) return false;
  if (!ctx.config.get().settings.recruitment) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name = normalizeGameName(interaction.fields.getTextInputValue(RECRUIT_FIELDS.name));

  let character;
  try {
    character = await ctx.registration.lookup(name);
  } catch (error) {
    if (!(error instanceof GameApiError)) throw error;
    await interaction.editReply(`⚠️ ${t.apiDown}`);
    return true;
  }
  if (!character) {
    await interaction.editReply(`⚠️ ${t.notFound(name)}`);
    return true;
  }

  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.recruitmentDesk.submit(actor, character);
  await interaction.editReply(
    outcome.status === 'ok' ? t.sent(character.name) : failureText(outcome),
  );
  return true;
}
