import {
  MessageFlags,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { FORM_KINDS, type ApplicationKind, type FormKind } from '../../core/application-rules.js';
import type { CharacterProfile } from '../../core/game-character.js';
import { normalizeGameName } from '../../core/registration.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { GameApiError } from '../../services/game-character.service.js';
import { RECRUIT_APPLY_ID } from '../../setup/desired.js';
import type { CommandContext } from '../commands/types.js';
import { numericPart, parseCustomId } from '../custom-id.js';
import {
  applicationModal,
  kindMenu,
  kindText,
  RECRUIT_DECIDE_PREFIX,
  RECRUIT_FIELDS,
  RECRUIT_MODAL_ID,
} from '../recruitment.js';
import { failureText, replyPrivately } from '../replies.js';

const t = ptBR.recruitment;
const KINDS: readonly ApplicationKind[] = ['member', 'ally', 'partner', 'restricted'];

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

/** Mudar: a menu only the officer sees, with the types approving can give. */
async function openKindMenu(interaction: ButtonInteraction, ctx: CommandContext, id: number) {
  const application = ctx.applications.get(id);
  if (!application || application.status !== 'pending') {
    await replyPrivately(interaction, `⚠️ ${application ? t.alreadyDecided : t.gone}`);
    return;
  }
  const actor = await ctx.resolveActor(interaction.user.id);
  if (actor.tier !== 'officer' && actor.tier !== 'commander') {
    await replyPrivately(interaction, ptBR.errors.denied('officer'));
    return;
  }
  await replyPrivately(interaction, {
    content: t.changePrompt,
    components: [kindMenu(application)],
  });
}

/** "Enviar minha ficha" and the officers' Aprovar/Recusar/Mudar. Returns false for other buttons. */
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
  if (id === undefined) return false;
  if (action === 'change') {
    await openKindMenu(interaction, ctx, id);
    return true;
  }
  if (action !== 'approve' && action !== 'reject') return false;

  // Registering can take a few seconds; the desk updates the card itself once it is decided.
  await interaction.deferUpdate();
  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.recruitmentDesk.decide(actor, id, action === 'approve');
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
  const [action, rawId] = parseCustomId(interaction.customId, RECRUIT_DECIDE_PREFIX) ?? [];
  const id = numericPart(rawId);
  if (action !== 'kind' || id === undefined) return false;
  const kind = KINDS.find((k) => k === interaction.values[0]);
  if (!kind) return false;

  await interaction.deferUpdate();
  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.recruitmentDesk.changeKind(actor, id, kind);
  await interaction.editReply({
    content:
      outcome.status === 'ok'
        ? t.changed(kindText(outcome.value.kind, outcome.value.allianceLegion))
        : failureText(outcome),
    components: [],
  });
  return true;
}

/** The submitted form: checks the character on the official site and tells the officers. */
export async function handleRecruitModal(
  interaction: ModalSubmitInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (interaction.customId !== RECRUIT_MODAL_ID) return false;
  if (!ctx.config.get().settings.recruitment) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const pickedValue = interaction.fields.getStringSelectValues(RECRUIT_FIELDS.kind)[0];
  const picked: FormKind = FORM_KINDS.find((k) => k === pickedValue) ?? 'member';
  const name = normalizeGameName(interaction.fields.getTextInputValue(RECRUIT_FIELDS.name));

  let character: CharacterProfile | null = null;
  if (name) {
    try {
      character = await ctx.registration.lookup(name);
    } catch (error) {
      if (!(error instanceof GameApiError)) throw error;
      await interaction.editReply(`⚠️ ${ptBR.profile.apiDown}`);
      return true;
    }
    if (!character) {
      await interaction.editReply(`⚠️ ${t.notFound(name)}`);
      return true;
    }
  }

  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.recruitmentDesk.submit(actor, { picked, character });
  // A Parceiro without a character is shown by their Discord name.
  const shown =
    character?.name ??
    (interaction.inCachedGuild() ? interaction.member.displayName : interaction.user.username);
  await interaction.editReply(
    outcome.status !== 'ok'
      ? failureText(outcome)
      : outcome.value.autoApproved
        ? t.autoApproved(shown)
        : t.sent(shown),
  );
  return true;
}
