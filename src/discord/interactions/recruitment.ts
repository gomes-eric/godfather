import { MessageFlags, type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
import type { CharacterProfile } from '../../core/game-character.js';
import { registerCharacter } from '../character-registration.js';
import { normalizeGameName } from '../../core/registration.js';
import type { Application } from '../../db/applications.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { GameApiError } from '../../services/game-character.service.js';
import type { CommandContext } from '../commands/types.js';
import {
  applicationCard,
  applicationModal,
  RECRUIT_APPLY_ID,
  RECRUIT_DECIDE_PREFIX,
  RECRUIT_FIELDS,
  RECRUIT_MODAL_ID,
} from '../recruitment.js';
import { outcomeMessage } from './confirmation.js';

const t = ptBR.recruitment;

async function cardFor(ctx: CommandContext, application: Application) {
  const member = await ctx.guild.members.fetch(application.userId).catch(() => null);
  return applicationCard(application, {
    classEmoji: ctx.recruitment.classRole(application.className)?.emoji ?? '🎮',
    avatarUrl: member?.displayAvatarURL({ size: 256 }) ?? null,
    legionName: ctx.config.get().settings.characters.legion,
  });
}

/** The character as stored in the application, in the shape the registration uses. */
function characterOf(application: Application): CharacterProfile {
  return {
    id: application.characterId,
    name: application.characterName,
    serverId: application.serverId,
    className: application.className,
    level: application.level,
    combatPower: application.combatPower,
    itemLevel: application.itemLevel,
    legion: application.legion,
    title: null,
    avatarUrl: null,
  };
}

/** "Quero entrar na legião" and the officers' Aprovar/Recusar. Returns false for other buttons. */
export async function handleRecruitButton(
  interaction: ButtonInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (!ctx.config.get().settings.recruitment) return false;

  if (interaction.customId === RECRUIT_APPLY_ID) {
    const actor = await ctx.resolveActor(interaction.user.id);
    const problem =
      actor.tier !== 'visitor'
        ? t.alreadyMember
        : ctx.applications.pendingFor(actor.userId)
          ? t.alreadyPending
          : null;
    if (problem) {
      await interaction.reply({ content: `⚠️ ${problem}`, flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.showModal(applicationModal(ctx.registrations.get(actor.userId)?.name));
    return true;
  }

  if (!interaction.customId.startsWith(RECRUIT_DECIDE_PREFIX)) return false;
  const [action, rawId] = interaction.customId.slice(RECRUIT_DECIDE_PREFIX.length).split(':');
  const id = Number(rawId);
  if ((action !== 'approve' && action !== 'reject') || !Number.isInteger(id)) return false;

  const actor = await ctx.resolveActor(interaction.user.id);
  const application = ctx.applications.get(id);
  if (action === 'approve' && application) {
    const member = await ctx.guild.members.fetch(application.userId).catch(() => null);
    if (!member) {
      await interaction.reply({ content: `⚠️ ${t.leftServer}`, flags: MessageFlags.Ephemeral });
      return true;
    }
  }

  let nickname: string | null = null;
  const outcome = await ctx.recruitment.decide(actor, id, action === 'approve', async (app) => {
    const classRole = ctx.recruitment.classRole(app.className);
    if (classRole) {
      const result = await registerCharacter(
        ctx,
        app.userId,
        characterOf(app),
        classRole,
        'Ficha de recrutamento aprovada',
      );
      if (result.nicknameSet) nickname = result.nickname;
    }
    await ctx.members.promote(actor, app.userId, 'soldier');
  });
  if (outcome.status !== 'ok') {
    await interaction.reply({
      content:
        outcome.status === 'confirmation_required' ? outcome.preview : outcomeMessage(outcome),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const decided = outcome.value;
  await interaction.update({ ...(await cardFor(ctx, decided)), allowedMentions: { parse: [] } });
  // Approved: they are Soldado now; tell them in the channel (no DMs) what is left to do.
  if (decided.status === 'approved') {
    const settings = ctx.config.get().settings;
    const channel = ctx.directory.channelByKey(settings.recruitment!.announceChannel);
    await channel?.send({
      content: t.welcome(decided.userId, settings.characters.legion, nickname),
      allowedMentions: { users: [decided.userId] },
    });
    ctx.legion
      .refreshRanking()
      .catch((error: unknown) => ctx.logger.warn({ err: error }, 'ranking refresh failed'));
  }
  return true;
}

/** The submitted application: checks the character on the official site and tells the officers. */
export async function handleRecruitModal(
  interaction: ModalSubmitInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (interaction.customId !== RECRUIT_MODAL_ID) return false;
  const settings = ctx.config.get().settings;
  if (!settings.recruitment) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name = normalizeGameName(interaction.fields.getTextInputValue(RECRUIT_FIELDS.name));
  const schedule = interaction.fields.getTextInputValue(RECRUIT_FIELDS.schedule).trim();
  const reason = interaction.fields.getTextInputValue(RECRUIT_FIELDS.reason).trim();

  let character: CharacterProfile | null;
  try {
    const ref = await ctx.characters.find(name, true);
    character = ref && (await ctx.characters.profile(ref, true));
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
  const outcome = await ctx.recruitment.apply(actor, { character, reason, schedule });
  if (outcome.status !== 'ok') {
    await interaction.editReply(
      outcome.status === 'confirmation_required' ? outcome.preview : outcomeMessage(outcome),
    );
    return true;
  }

  const review = ctx.directory.channelByKey(settings.recruitment.reviewChannel);
  const pingId = settings.recruitment.pingRole
    ? ctx.directory.roleId(settings.recruitment.pingRole)
    : undefined;
  if (review) {
    const sent = await review.send({
      ...(pingId && { content: t.newApplication(pingId) }),
      ...(await cardFor(ctx, outcome.value)),
      allowedMentions: { roles: pingId ? [pingId] : [] },
    });
    ctx.recruitment.attachMessage(outcome.value.id, sent.id);
  }
  await interaction.editReply(t.sent(character.name));
  return true;
}
