import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { matchClass, sameLegion } from '../../core/game-character.js';
import {
  checkGameName,
  normalizeGameName,
  registrationNickname,
  rolesWithClass,
  stripClassEmoji,
} from '../../core/registration.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { GameApiError } from '../../services/game-character.service.js';
import { REGISTER_BUTTON_ID } from '../../setup/desired.js';
import type { CommandContext } from '../commands/types.js';
import { outcomeMessage } from './confirmation.js';

const t = ptBR.registration;
const MODAL_ID = 'register:submit';
const NAME_FIELD = 'name';

function classRoles(ctx: CommandContext) {
  return ctx.config.get().roles.filter((role) => role.class && role.emoji);
}

/** The "Registrar" button in #registro: opens the form, pre-filled with their current name. */
export async function handleRegisterButton(
  interaction: ButtonInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (interaction.customId !== REGISTER_BUTTON_ID) return false;

  const member = await ctx.guild.members.fetch(interaction.user.id);
  const registered = ctx.registrations.get(member.id);
  const name = (
    registered?.name ??
    stripClassEmoji(
      member.displayName,
      classRoles(ctx).map((r) => r.emoji!),
    )
  ).slice(0, 30);

  const input = new TextInputBuilder()
    .setCustomId(NAME_FIELD)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(30)
    .setPlaceholder(t.namePlaceholder)
    .setValue(name);
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(MODAL_ID)
      .setTitle(t.modalTitle)
      .addLabelComponents(
        new LabelBuilder()
          .setLabel(t.nameLabel)
          .setDescription(t.nameHint)
          .setTextInputComponent(input),
      ),
  );
  return true;
}

/**
 * The submitted form: finds the character on the official site, checks the legion, and sets the
 * class role (from the game) and the "⚔️ Nome" nickname together.
 */
export async function handleRegisterModal(
  interaction: ModalSubmitInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (interaction.customId !== MODAL_ID) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const typed = normalizeGameName(interaction.fields.getTextInputValue(NAME_FIELD));
  const basic = checkGameName(typed, '');
  if (basic === 'empty' || basic === 'invalid') {
    await interaction.editReply(`⚠️ ${t.problems[basic]}`);
    return true;
  }

  const lookup = ctx.config.get().settings.characters;
  let found;
  try {
    const ref = await ctx.characters.find(typed, true);
    found = ref && (await ctx.characters.profile(ref, true));
  } catch (error) {
    if (!(error instanceof GameApiError)) throw error;
    await interaction.editReply(`⚠️ ${t.apiDown}`);
    return true;
  }
  if (!found) {
    await interaction.editReply(`⚠️ ${t.notFound(typed)}`);
    return true;
  }
  if (lookup.requireLegion && !sameLegion(found.legion, lookup.legion)) {
    await interaction.editReply(`⚠️ ${t.notInLegion(found.name, lookup.legion, found.legion)}`);
    return true;
  }
  const roles = classRoles(ctx);
  const chosen = matchClass(found.className, roles);
  const chosenId = chosen && ctx.directory.roleId(chosen.key);
  if (!chosen || !chosenId) {
    await interaction.editReply(`⚠️ ${t.unknownGameClass(found.className)}`);
    return true;
  }
  const nickname = registrationNickname(chosen.emoji!, found.name);
  if (checkGameName(found.name, chosen.emoji!) === 'tooLong') {
    await interaction.editReply(`⚠️ ${t.problems.tooLong}`);
    return true;
  }

  const actor = await ctx.resolveActor(interaction.user.id);
  const character = found;
  const outcome = await ctx.runAction({
    actor,
    action: 'member.register',
    target: nickname,
    params: { class: chosen.key, gameName: character.name, legion: character.legion },
    preview: nickname,
    execute: async () => {
      const member = await ctx.guild.members.fetch(interaction.user.id);
      const classIds = roles
        .map((r) => ctx.directory.roleId(r.key))
        .filter((id): id is string => id !== undefined);
      const current = [...member.roles.cache.keys()].filter((id) => id !== ctx.guild.id);
      await member.roles.set(rolesWithClass(current, chosenId, classIds));
      ctx.registrations.save({
        userId: member.id,
        characterId: character.id,
        name: character.name,
        serverId: character.serverId,
        classKey: chosen.key,
      });
      // Discord never lets a bot rename the server owner or anyone ranked above it.
      if (member.id === ctx.guild.ownerId || !member.manageable) {
        return t.registeredNoNick(nickname, chosen.name);
      }
      await member.setNickname(nickname, 'Registro em #registro');
      return t.registered(nickname, chosen.name);
    },
  });

  await interaction.editReply(
    outcome.status === 'confirmation_required' ? outcome.preview : outcomeMessage(outcome),
  );
  return true;
}
