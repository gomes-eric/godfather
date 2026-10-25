import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { RoleConfig } from '../../config/schema.js';
import {
  checkGameName,
  normalizeGameName,
  registrationNickname,
  stripClassEmoji,
} from '../../core/registration.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { REGISTER_BUTTON_ID } from '../../setup/desired.js';
import type { CommandContext } from '../commands/types.js';

const t = ptBR.registration;
const MODAL_ID = 'register:submit';
const NAME_FIELD = 'name';
const CLASS_FIELD = 'class';

function classRoles(ctx: CommandContext): RoleConfig[] {
  return ctx.config.get().roles.filter((role) => role.class && role.emoji);
}

function currentClass(member: GuildMember, ctx: CommandContext, roles: RoleConfig[]) {
  return roles.find((role) => {
    const id = ctx.directory.roleId(role.key);
    return id !== undefined && member.roles.cache.has(id);
  });
}

/** The "Registrar" button in #registro: opens the form, pre-filled with what they have now. */
export async function handleRegisterButton(
  interaction: ButtonInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (interaction.customId !== REGISTER_BUTTON_ID) return false;

  const member = await ctx.guild.members.fetch(interaction.user.id);
  const roles = classRoles(ctx);
  const current = currentClass(member, ctx, roles);
  const name = stripClassEmoji(
    member.displayName,
    roles.map((r) => r.emoji!),
  ).slice(0, 30);

  const nameInput = new TextInputBuilder()
    .setCustomId(NAME_FIELD)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(30)
    .setPlaceholder(t.namePlaceholder)
    .setValue(name);
  const classSelect = new StringSelectMenuBuilder()
    .setCustomId(CLASS_FIELD)
    .setPlaceholder(t.classPlaceholder)
    .setRequired(true)
    .addOptions(
      roles.map((role) => ({
        label: role.name,
        value: role.key,
        emoji: role.emoji!,
        default: role.key === current?.key,
      })),
    );

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(MODAL_ID)
      .setTitle(t.modalTitle)
      .addLabelComponents(
        new LabelBuilder()
          .setLabel(t.nameLabel)
          .setDescription(t.nameHint)
          .setTextInputComponent(nameInput),
        new LabelBuilder().setLabel(t.classLabel).setStringSelectMenuComponent(classSelect),
      ),
  );
  return true;
}

/** The submitted form: sets the main class role and the "⚔️ Nome" nickname together. */
export async function handleRegisterModal(
  interaction: ModalSubmitInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (interaction.customId !== MODAL_ID) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const roles = classRoles(ctx);
  const chosen = roles.find(
    (r) => r.key === interaction.fields.getStringSelectValues(CLASS_FIELD)[0],
  );
  const chosenId = chosen && ctx.directory.roleId(chosen.key);
  if (!chosen || !chosenId) {
    await interaction.editReply(t.unknownClass);
    return true;
  }
  const gameName = normalizeGameName(interaction.fields.getTextInputValue(NAME_FIELD));
  const problem = checkGameName(gameName, chosen.emoji!);
  if (problem) {
    await interaction.editReply(`⚠️ ${t.problems[problem]}`);
    return true;
  }
  const nickname = registrationNickname(chosen.emoji!, gameName);

  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.runAction({
    actor,
    action: 'member.register',
    target: nickname,
    params: { class: chosen.key, gameName },
    preview: nickname,
    execute: async () => {
      const member = await ctx.guild.members.fetch(interaction.user.id);
      const otherClassIds = new Set(
        roles.map((r) => ctx.directory.roleId(r.key)).filter((id) => id !== chosenId),
      );
      await member.roles.set([
        ...member.roles.cache
          .filter((r) => r.id !== ctx.guild.id && !otherClassIds.has(r.id))
          .keys(),
        chosenId,
      ]);
      // Discord never lets a bot rename the server owner or anyone ranked above it.
      if (member.id === ctx.guild.ownerId || !member.manageable) {
        return t.registeredNoNick(nickname, chosen.name);
      }
      await member.setNickname(nickname, 'Registro em #registro');
      return t.registered(nickname, chosen.name);
    },
  });

  await interaction.editReply(
    outcome.status === 'ok'
      ? outcome.value
      : outcome.status === 'denied'
        ? ptBR.errors.denied(outcome.requiredTier)
        : outcome.preview,
  );
  return true;
}
