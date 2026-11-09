import { ChannelType, ThreadAutoArchiveDuration, type Guild, type ThreadChannel } from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { sameLegion, type CharacterProfile } from '../core/game-character.js';
import type { Application, ApplicationStore } from '../db/applications.js';
import type { GuildDirectory } from '../discord/directory.js';
import { fetchMember } from '../discord/members.js';
import { applicationCard } from '../discord/recruitment.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
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
  now?: () => Date;
}

/** How long a decided application's private thread stays before it is deleted. */
export const THREAD_LIFETIME_MS = { approved: 60 * 60_000, rejected: 6 * 60 * 60_000 } as const;
const SWEEP_MS = 5 * 60_000;

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
 * card in a private thread that only the applicant, Oficiais and Comandantes see, so the channel
 * holds only the form, and carries out a decision (register the character, make them Soldado,
 * update the card, welcome them; no DMs).
 */
export class RecruitmentDesk implements BackgroundJob {
  constructor(private readonly deps: Deps) {}

  private settings() {
    return this.deps.config.get().settings;
  }

  async card(application: Application) {
    const member = await fetchMember(this.deps.guild, application.userId);
    return applicationCard(application, {
      classEmoji: this.deps.registration.classRole(application.className)?.emoji ?? '🎮',
      avatarUrl: member?.displayAvatarURL({ size: 256 }) ?? null,
      legionName: this.settings().characters.legion,
    });
  }

  /** Records the application and posts its card in a new private thread, pinging the configured role. */
  async submit(actor: Actor, character: CharacterProfile): Promise<ServiceOutcome<Application>> {
    const outcome = await this.deps.recruitment.apply(actor, character);
    const recruitment = this.settings().recruitment;
    if (outcome.status !== 'ok' || !recruitment) return outcome;

    const thread = await this.openThread(outcome.value);
    if (thread) {
      const pingId = recruitment.pingRole
        ? this.deps.directory.roleId(recruitment.pingRole)
        : undefined;
      const sent = await thread.send({
        ...(pingId && { content: t.newApplication(pingId) }),
        ...(await this.card(outcome.value)),
        allowedMentions: { roles: pingId ? [pingId] : [] },
      });
      this.deps.recruitment.attachMessage(outcome.value.id, sent.id, thread.id);
    }
    return outcome;
  }

  /**
   * A private thread for the application in the review channel, with the applicant and every
   * Oficial and Comandante in it: nobody else sees the card. Undefined without a review channel.
   */
  async openThread(application: Application): Promise<ThreadChannel | undefined> {
    const recruitment = this.settings().recruitment;
    const review = recruitment && this.deps.directory.channelByKey(recruitment.reviewChannel);
    if (!review) return undefined;
    const thread = await review.threads.create({
      name: t.threadName(application.characterName).slice(0, 100),
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });
    for (const userId of [application.userId, ...(await this.staffIds())]) {
      await thread.members
        .add(userId)
        .catch((error: unknown) =>
          this.deps.logger.warn({ err: error, userId }, 'could not add to the application thread'),
        );
    }
    return thread;
  }

  /** Members with the Oficial or Comandante role, who review the applications. */
  private async staffIds(): Promise<string[]> {
    const { officer, commander } = this.deps.directory.tierRoleIds();
    const roles = [officer, commander].filter((id): id is string => id !== undefined);
    const members = await this.deps.guild.members.fetch();
    return [...members.values()]
      .filter((member) => !member.user.bot && roles.some((id) => member.roles.cache.has(id)))
      .map((member) => member.id);
  }

  /** The application's thread (unarchived, so it can be written in), or the review channel for older cards. */
  private async cardChannel(application: Application) {
    if (!application.threadId) {
      const recruitment = this.settings().recruitment;
      return recruitment && this.deps.directory.channelByKey(recruitment.reviewChannel);
    }
    const thread = await this.deps.guild.channels.fetch(application.threadId).catch(() => null);
    if (!thread?.isThread()) return undefined;
    if (thread.archived) await thread.setArchived(false);
    return thread;
  }

  /** Approves or refuses an application, then updates its card and welcomes an approved member. */
  async decide(actor: Actor, id: number, approve: boolean): Promise<ServiceOutcome<Application>> {
    const pending = this.deps.applications.get(id);
    const member = pending && (await fetchMember(this.deps.guild, pending.userId));
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
      const announce = recruitment.announceChannel
        ? this.deps.directory.channelByKey(recruitment.announceChannel)
        : await this.cardChannel(decided);
      await announce?.send({
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

  /** Re-renders the application's card where it was posted (buttons go once it is decided). */
  private async refreshCard(application: Application): Promise<void> {
    if (!application.messageId) return;
    const channel = await this.cardChannel(application);
    const message = await channel?.messages.fetch(application.messageId);
    await message?.edit({ ...(await this.card(application)), allowedMentions: { parse: [] } });
  }

  /**
   * Deletes the private thread of each decided application once its time is up: an hour after an
   * approval (the welcome has been read), six hours after a refusal. Runs from the stored decision
   * time, so a restart doesn't lose track. Returns how many threads went.
   */
  async sweepThreads(): Promise<number> {
    const now = (this.deps.now ?? (() => new Date()))().getTime();
    let deleted = 0;
    for (const application of this.deps.applications.decidedWithThread()) {
      if (application.status === 'pending' || !application.decidedAt) continue;
      if (now - application.decidedAt.getTime() < THREAD_LIFETIME_MS[application.status]) continue;
      const thread = await this.deps.guild.channels.fetch(application.threadId!).catch(() => null);
      if (thread?.isThread()) {
        await thread.delete(t.threadClosedReason);
        deleted++;
      }
      this.deps.applications.forgetThread(application.id);
    }
    return deleted;
  }

  start(): () => void {
    return repeat(
      SWEEP_MS,
      () => this.sweepThreads(),
      (error) => this.deps.logger.warn({ err: error }, 'application thread sweep failed'),
    );
  }
}
