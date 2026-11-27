import {
  MessageFlags,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { APPLICATION_KINDS, FORM_KINDS } from '../../core/application-rules.js';
import { normalizeGameName } from '../../core/registration.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { RECRUIT_APPLY_ID } from '../../setup/desired.js';
import type { CommandContext } from '../commands/types.js';
import { numericPart, parseCustomId } from '../custom-id.js';
import {
  applicationModal,
  kindMenu,
  RECRUIT_CARD_PREFIX,
  RECRUIT_FIELDS,
  RECRUIT_MODAL_ID,
} from '../recruitment.js';
import { failureText, replyPrivately } from '../replies.js';
import { recruitmentSettings } from '../../config/views.js';

const t = ptBR.recruitment;

/** "Enviar minha ficha" and the officers' Aprovar/Recusar/Mudar. Returns false for other buttons. */
export async function handleRecruitButton(
  interaction: ButtonInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (!recruitmentSettings(ctx.config.get())) return false;
  const actor = () => ctx.resolveActor(interaction.user.id);

  if (interaction.customId === RECRUIT_APPLY_ID) {
    const applicant = await actor();
    const problem = ctx.recruitment.canApply(applicant);
    if (problem) {
      await replyPrivately(interaction, `⚠️ ${problem}`);
      return true;
    }
    const { characterName } = ctx.recruitment.formDefaults(applicant.userId);
    await interaction.showModal(applicationModal(characterName));
    return true;
  }

  const [action, rawId] = parseCustomId(interaction.customId, RECRUIT_CARD_PREFIX) ?? [];
  const id = numericPart(rawId);
  if (id === undefined) return false;
  if (action === 'change') {
    const choices = ctx.recruitment.kindChoices(await actor(), id);
    await replyPrivately(
      interaction,
      choices.status === 'ok'
        ? { content: t.changePrompt, components: [kindMenu(choices.value)] }
        : failureText(choices),
    );
    return true;
  }
  if (action !== 'approve' && action !== 'reject') return false;

  // Registering can take a few seconds; the module updates the card itself once it is decided.
  await interaction.deferUpdate();
  const outcome = await ctx.recruitment.decide(await actor(), id, action === 'approve');
  if (outcome.status !== 'ok') {
    await interaction.followUp({ content: failureText(outcome), flags: MessageFlags.Ephemeral });
  }
  return true;
}

/** The officer picked a type in Mudar's menu: the card shows it, and Aprovar gives it. */
export async function handleRecruitSelect(
  interaction: StringSelectMenuInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  const [action, rawId] = parseCustomId(interaction.customId, RECRUIT_CARD_PREFIX) ?? [];
  const id = numericPart(rawId);
  if (action !== 'kind' || id === undefined) return false;
  const kind = APPLICATION_KINDS.find((k) => k === interaction.values[0]);
  if (!kind) return false;

  await interaction.deferUpdate();
  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.recruitment.changeKind(actor, id, kind);
  await interaction.editReply({
    content:
      outcome.status === 'ok'
        ? t.changed(ctx.recruitment.kindName(outcome.value))
        : failureText(outcome),
    components: [],
  });
  return true;
}

/** The submitted form; the module checks the character on the official site. */
export async function handleRecruitModal(
  interaction: ModalSubmitInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (interaction.customId !== RECRUIT_MODAL_ID) return false;
  if (!recruitmentSettings(ctx.config.get())) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const pickedValue = interaction.fields.getStringSelectValues(RECRUIT_FIELDS.kind)[0];
  const picked = FORM_KINDS.find((k) => k === pickedValue) ?? 'member';
  const name = normalizeGameName(interaction.fields.getTextInputValue(RECRUIT_FIELDS.name));

  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.recruitment.submit(actor, {
    picked,
    characterName: name || null,
  });
  await interaction.editReply(
    outcome.status !== 'ok'
      ? failureText(outcome)
      : outcome.value.autoApproved
        ? t.autoApproved(outcome.value.shownName)
        : t.sent(outcome.value.shownName),
  );
  return true;
}
