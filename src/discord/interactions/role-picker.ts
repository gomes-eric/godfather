import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { ROLE_PICKER_PREFIX } from '../../setup/desired.js';
import type { CommandContext } from '../commands/types.js';

/** Class buttons from the #escolha-seu-cargo panel (PLAN.md §6.9). */
export async function handleRolePickerButton(
  interaction: ButtonInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (!interaction.customId.startsWith(ROLE_PICKER_PREFIX)) return false;

  const config = ctx.config.get();
  const classRoles = config.roles.filter((role) => role.class);
  const chosen = classRoles.find(
    (role) => role.key === interaction.customId.slice(ROLE_PICKER_PREFIX.length),
  );
  const chosenId = chosen && ctx.directory.roleId(chosen.key);
  if (!chosen || !chosenId) {
    await interaction.reply({ content: ptBR.classes.unknown, flags: MessageFlags.Ephemeral });
    return true;
  }

  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.runAction({
    actor,
    action: 'class.select',
    target: chosen.name,
    preview: chosen.name,
    execute: async () => {
      const member = await ctx.guild.members.fetch(interaction.user.id);
      if (member.roles.cache.has(chosenId)) {
        await member.roles.remove(chosenId);
        return ptBR.classes.removed(chosen.name);
      }

      const previous = config.settings.rolePicker.multipleClasses
        ? []
        : classRoles.filter((role) => {
            const id = ctx.directory.roleId(role.key);
            return id !== undefined && id !== chosenId && member.roles.cache.has(id);
          });
      const previousIds = previous.map((role) => ctx.directory.roleId(role.key)!);
      await member.roles.set([
        ...member.roles.cache.filter((r) => !previousIds.includes(r.id)).keys(),
        chosenId,
      ]);
      return previous.length > 0
        ? ptBR.classes.switched(
            chosen.name,
            previous.map((r) => r.name),
          )
        : ptBR.classes.added(chosen.name);
    },
  });

  const content =
    outcome.status === 'ok'
      ? outcome.value
      : outcome.status === 'denied'
        ? ptBR.errors.denied(outcome.requiredTier)
        : outcome.preview;
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  return true;
}
