import type { Guild } from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { sameLegion, type CharacterProfile } from '../core/game-character.js';
import type { Application, ApplicationStore } from '../db/applications.js';
import type { GuildDirectory } from '../discord/directory.js';
import { applicationCard } from '../discord/recruitment.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import type { RecruitmentService } from './recruitment.service.js';
import type { RegistrationService } from './registration.service.js';

const t = ptBR.recruitment;

interface Deps {
  guild: Guild;
  config: ConfigStore;
  directory: GuildDirectory;
  recruitment: RecruitmentService;
  applications: ApplicationStore;
  registration: RegistrationService;
  logger: Logger;
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

/**
 * Recruitment in Discord, for the #recrutamento buttons and MCP alike: posts each application
 * card for the officers, and carries out a decision (register the character, make them Soldado,
 * update the card, welcome them in the channel; no DMs).
 */
export class RecruitmentDesk {
  constructor(private readonly deps: Deps) {}

  private settings() {
    return this.deps.config.get().settings;
  }

  async card(application: Application) {
    const member = await this.deps.guild.members.fetch(application.userId).catch(() => null);
    return applicationCard(application, {
      classEmoji: this.deps.registration.classRole(application.className)?.emoji ?? '🎮',
      avatarUrl: member?.displayAvatarURL({ size: 256 }) ?? null,
      legionName: this.settings().characters.legion,
    });
  }

  /** Records the application and posts its card for the officers, pinging the configured role. */
  async submit(actor: Actor, character: CharacterProfile): Promise<ServiceOutcome<Application>> {
    const outcome = await this.deps.recruitment.apply(actor, character);
    const recruitment = this.settings().recruitment;
    if (outcome.status !== 'ok' || !recruitment) return outcome;

    const review = this.deps.directory.channelByKey(recruitment.reviewChannel);
    const pingId = recruitment.pingRole
      ? this.deps.directory.roleId(recruitment.pingRole)
      : undefined;
    if (review) {
      const sent = await review.send({
        ...(pingId && { content: t.newApplication(pingId) }),
        ...(await this.card(outcome.value)),
        allowedMentions: { roles: pingId ? [pingId] : [] },
      });
      this.deps.recruitment.attachMessage(outcome.value.id, sent.id);
    }
    return outcome;
  }

  /** Approves or refuses an application, then updates its card and welcomes an approved member. */
  async decide(actor: Actor, id: number, approve: boolean): Promise<ServiceOutcome<Application>> {
    const pending = this.deps.applications.get(id);
    const member =
      pending && (await this.deps.guild.members.fetch(pending.userId).catch(() => null));
    if (approve && pending && !member) return rejected(t.leftServer);

    let nickname: string | null = null;
    const outcome = await this.deps.recruitment.decide(actor, id, approve, async (application) => {
      const classRole = this.deps.registration.classRole(application.className);
      if (member && classRole) {
        const admitted = await this.deps.registration.admit(
          actor,
          member,
          characterOf(application),
          classRole,
          t.approvedReason,
        );
        nickname = admitted.nickname;
      }
    });
    if (outcome.status !== 'ok') return outcome;

    const decided = outcome.value;
    await this.refreshCard(decided).catch((error: unknown) =>
      this.deps.logger.warn({ err: error, application: id }, 'could not update the card'),
    );
    const recruitment = this.settings().recruitment;
    if (decided.status === 'approved' && recruitment) {
      await this.deps.directory.channelByKey(recruitment.announceChannel)?.send({
        content: t.welcome(
          decided.userId,
          this.settings().characters.legion,
          nickname,
          sameLegion(decided.legion, this.settings().characters.legion),
        ),
        allowedMentions: { users: [decided.userId] },
      });
    }
    return outcome;
  }

  /** Re-renders the application's card in the review channel (buttons go once it is decided). */
  private async refreshCard(application: Application): Promise<void> {
    const recruitment = this.settings().recruitment;
    if (!recruitment || !application.messageId) return;
    const channel = this.deps.directory.channelByKey(recruitment.reviewChannel);
    const message = await channel?.messages.fetch(application.messageId);
    await message?.edit({ ...(await this.card(application)), allowedMentions: { parse: [] } });
  }
}
