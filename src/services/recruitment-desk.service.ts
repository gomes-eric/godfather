import {
  ChannelType,
  ThreadAutoArchiveDuration,
  type Guild,
  type GuildMember,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ServiceOutcome } from '../core/action.js';
import { systemActor, type Actor } from '../core/actor.js';
import { findAlliance } from '../core/alliances.js';
import {
  approvedStanding,
  planApplication,
  type ApplicationKind,
  type FormKind,
} from '../core/application-rules.js';
import { sameLegion, type CharacterProfile } from '../core/game-character.js';
import { decodeStanding, SOLDIER, type Standing } from '../core/standing.js';
import { tierAtLeast } from '../core/tiers.js';
import type { ActionName } from '../core/permissions.js';
import type { Application, ApplicationStore } from '../db/applications.js';
import type { GuildDirectory } from '../discord/directory.js';
import { fetchMember } from '../discord/members.js';
import { notifyOfficers, officerChannel } from '../discord/officer-notices.js';
import { applicationCard, kindText } from '../discord/recruitment.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import type { AllianceService } from './alliance.service.js';
import type { MemberService } from './member.service.js';
import type { RecruitmentService, ReviewInput } from './recruitment.service.js';
import type { RegistrationService } from './registration.service.js';

const t = ptBR.recruitment;

interface Deps {
  guild: Guild;
  config: ConfigStore;
  directory: GuildDirectory;
  recruitment: RecruitmentService;
  applications: ApplicationStore;
  registration: RegistrationService;
  members: MemberService;
  alliances: AllianceService;
  logger: Logger;
  now?: () => Date;
}

/** What someone sent with "Enviar minha ficha" (the character already read from the site). */
export interface SentForm {
  picked: FormKind;
  character: CharacterProfile | null;
  note: string | null;
}

/** How long a decided application's private thread stays before it is deleted. */
export const THREAD_LIFETIME_MS = { approved: 60 * 60_000, rejected: 6 * 60 * 60_000 } as const;
const SWEEP_MS = 5 * 60_000;

/** The audited action for moving someone to each standing. */
const MOVE_ACTION: Record<Standing['kind'], ActionName> = {
  tier: 'member.promote',
  ally: 'member.ally',
  partner: 'member.partner',
  restricted: 'member.restrict',
  visitor: 'member.demote',
};

/** The character as stored in the application, in the shape the registration uses. */
function characterOf(application: Application): CharacterProfile | null {
  if (!application.characterId || !application.characterName) return null;
  return {
    id: application.characterId,
    name: application.characterName,
    serverId: application.serverId ?? 0,
    className: application.className ?? '',
    level: application.level ?? 0,
    combatPower: application.combatPower,
    itemLevel: application.itemLevel,
    legion: application.legion,
    title: null,
    avatarUrl: null,
  };
}

/**
 * Recruitment in Discord, for the #recrutamento buttons and MCP alike: posts each application
 * card in a private thread that only the applicant, Oficiais and Comandantes see, and carries out
 * a decision (register the character, set the standing, update the card, welcome them; no DMs).
 * The daily check's reviews get the same card, in a thread in the officers' channel.
 */
export class RecruitmentDesk implements BackgroundJob {
  constructor(private readonly deps: Deps) {}

  private settings() {
    return this.deps.config.get().settings;
  }

  private isNewAlliance(application: Application): boolean {
    return (
      application.kind === 'ally' &&
      !findAlliance(this.deps.config.get().alliances, application.allianceLegion ?? '')
    );
  }

  async card(application: Application) {
    const member = await fetchMember(this.deps.guild, application.userId);
    const className = application.className;
    return applicationCard(application, {
      classEmoji: (className && this.deps.registration.classRole(className)?.emoji) || '🎮',
      avatarUrl: member?.displayAvatarURL({ size: 256 }) ?? null,
      legionName: this.settings().characters.legion,
      applicantName: member?.displayName ?? application.userId,
      newAlliance: this.isNewAlliance(application),
      previousStanding: application.previousStanding
        ? this.deps.members.standingName(decodeStanding(application.previousStanding))
        : null,
    });
  }

  /**
   * Records the form and posts its card in a new private thread, pinging the configured role. A
   * Membro whose character is already in the legion (and nobody else's) is approved right away.
   */
  async submit(
    actor: Actor,
    form: SentForm,
  ): Promise<ServiceOutcome<{ application: Application; autoApproved: boolean }>> {
    const { config, registration } = this.deps;
    const character = form.character;
    const owner = character ? registration.ownerOf(character.id, actor.userId) : undefined;
    const plan = planApplication({
      picked: form.picked,
      character,
      legion: this.settings().characters.legion,
      alliances: config.get().alliances,
      takenBySomeoneElse: owner !== undefined,
      restrictedByOfficer: ['manual', 'transfer'].includes(
        this.deps.members.restrictionOf(actor.userId) ?? '',
      ),
    });
    if ('refusal' in plan) return rejected(t[plan.refusal]);

    const outcome = await this.deps.recruitment.apply(actor, {
      picked: form.picked,
      kind: plan.kind,
      character,
      allianceLegion: plan.allianceLegion,
      note: form.note,
      duplicateOf: owner ?? null,
    });
    if (outcome.status !== 'ok') return outcome;
    const application = outcome.value;

    if (plan.autoApprove) {
      // The card and the welcome go in their private thread; nobody needs pinging.
      await this.post(application, { ping: false });
      const bot = systemActor(this.deps.guild.client.user.id);
      const decided = await this.decide(bot, application.id, true);
      if (decided.status === 'ok') {
        await notifyOfficers(
          this.deps,
          t.autoApprovedNotice(actor.userId, character!.name, this.settings().characters.legion),
        );
        return { status: 'ok', value: { application: decided.value, autoApproved: true } };
      }
      // Could not approve on its own (a missing role…): leave it to the officers.
      this.deps.logger.warn({ application: application.id, decided }, 'auto-approval failed');
      await notifyOfficers(this.deps, t.autoApprovalFailed(actor.userId, character!.name));
      return { status: 'ok', value: { application, autoApproved: false } };
    }

    await this.post(application, { ping: true });
    if (owner && character) {
      await notifyOfficers(this.deps, t.duplicateNotice(actor.userId, character.name, owner));
    }
    return { status: 'ok', value: { application, autoApproved: false } };
  }

  /**
   * The daily check changed someone's standing (or saw an Oficial leave): a card in a private
   * thread in the officers' channel, where Aprovar keeps it and Recusar puts the old one back.
   */
  async openReview(input: ReviewInput): Promise<void> {
    const bot = systemActor(this.deps.guild.client.user.id);
    const outcome = await this.deps.recruitment.openReview(bot, input);
    if (outcome.status === 'ok') await this.post(outcome.value, { ping: true });
  }

  /** Posts the card in the application's thread (created now), pinging the review role. */
  private async post(application: Application, options: { ping: boolean }): Promise<void> {
    const thread = await this.openThread(application);
    if (!thread) return;
    const recruitment = this.settings().recruitment;
    const pingId =
      options.ping && recruitment?.pingRole
        ? this.deps.directory.roleId(recruitment.pingRole)
        : undefined;
    const ping = application.origin === 'check' ? t.newReview : t.newApplication;
    const sent = await thread.send({
      ...(pingId && { content: ping(pingId) }),
      ...(await this.card(application)),
      allowedMentions: { roles: pingId ? [pingId] : [] },
    });
    this.deps.recruitment.attachMessage(application.id, sent.id, thread.id);
  }

  /**
   * A private thread for the application with every Oficial and Comandante in it: in the review
   * channel with the applicant too, or in the officers' channel for the daily check's reviews.
   * Undefined without that channel.
   */
  async openThread(application: Application): Promise<ThreadChannel | undefined> {
    const fromCheck = application.origin === 'check';
    const parent: TextChannel | undefined = fromCheck
      ? officerChannel(this.deps.directory, this.deps.config)
      : (() => {
          const recruitment = this.settings().recruitment;
          return recruitment && this.deps.directory.channelByKey(recruitment.reviewChannel);
        })();
    if (!parent) return undefined;
    const member = await fetchMember(this.deps.guild, application.userId);
    const name = application.characterName ?? member?.displayName ?? application.userId;
    const thread = await parent.threads.create({
      name: (fromCheck ? t.reviewThreadName(name) : t.threadName(name)).slice(0, 100),
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });
    const people = fromCheck
      ? await this.staffIds()
      : [application.userId, ...(await this.staffIds())];
    for (const userId of people) {
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

  /** Mudar: the type approving will give. Aliança takes the character's legion. */
  async changeKind(
    actor: Actor,
    id: number,
    kind: ApplicationKind,
  ): Promise<ServiceOutcome<Application>> {
    const application = this.deps.applications.get(id);
    if (!application) return rejected(t.gone);
    if (kind === 'restricted' && application.origin !== 'check') {
      return rejected(t.restrictedOnlyReviews);
    }
    if ((kind === 'member' || kind === 'ally') && !application.characterId) {
      return rejected(t.noCharacterForKind);
    }
    let allianceLegion: string | null = null;
    if (kind === 'ally') {
      if (!application.legion) return rejected(t.noLegionForKind);
      allianceLegion =
        findAlliance(this.deps.config.get().alliances, application.legion)?.legion ??
        application.legion;
    }
    const outcome = await this.deps.recruitment.changeKind(actor, id, kind, allianceLegion);
    if (outcome.status === 'ok') {
      await this.refreshCard(outcome.value).catch((error: unknown) =>
        this.deps.logger.warn({ err: error, application: id }, 'could not update the card'),
      );
    }
    return outcome;
  }

  /**
   * Approves or refuses an application, then updates its card and welcomes whoever came in
   * through the form. Approving gives the standing of its type; refusing a daily check review
   * puts the previous standing back.
   */
  async decide(actor: Actor, id: number, approve: boolean): Promise<ServiceOutcome<Application>> {
    const pending = this.deps.applications.get(id);
    if (!pending) return rejected(t.gone);
    const member = await fetchMember(this.deps.guild, pending.userId);
    if (!member && (approve || pending.origin === 'check')) return rejected(t.leftServer);

    // What the decision will make of them, checked before anything changes.
    let target: Standing | undefined;
    if (approve && member && this.isNewAlliance(pending)) {
      // Creating the alliance comes first, so make sure they can be moved at all (an ally
      // stands where Soldado does) before anything is created.
      const refusal = this.deps.members.refusalFor(actor, member, SOLDIER);
      if (refusal) return rejected(refusal);
    }
    if (approve) {
      const prepared = await this.prepareApproval(actor, pending);
      if (prepared.status !== 'ok') return prepared;
      target = prepared.value;
    } else if (pending.origin === 'check' && pending.previousStanding) {
      target = decodeStanding(pending.previousStanding);
    }
    if (member && target) {
      const refusal = this.deps.members.refusalFor(actor, member, target);
      if (refusal) return rejected(refusal);
    }

    let nickname: string | null = null;
    const outcome = await this.deps.recruitment.decide(actor, id, approve, async (application) => {
      if (!member || !target) return;
      const character = application.origin === 'form' ? characterOf(application) : null;
      const classRole = character && this.deps.registration.classRole(character.className);
      if (character && classRole) {
        nickname = await this.deps.registration.link(
          actor,
          member,
          character,
          classRole,
          t.approvedReason,
        );
      }
      await this.moveTo(actor, member, target);
    });
    if (outcome.status !== 'ok') return outcome;

    const decided = outcome.value;
    await this.refreshCard(decided).catch((error: unknown) =>
      this.deps.logger.warn({ err: error, application: id }, 'could not update the card'),
    );
    if (decided.status === 'approved' && decided.origin === 'form') {
      await this.welcome(decided, nickname).catch((error: unknown) =>
        this.deps.logger.warn({ err: error, application: id }, 'could not post the welcome'),
      );
    }
    return outcome;
  }

  /**
   * The standing approving gives. An Aliança with a legion that is not an alliance yet needs a
   * Comandante, and approving it creates the alliance first.
   */
  private async prepareApproval(
    actor: Actor,
    application: Application,
  ): Promise<ServiceOutcome<Standing>> {
    const alliances = () => this.deps.config.get().alliances;
    let standing = approvedStanding(application.kind, application.allianceLegion, alliances());
    if (!standing && application.kind === 'ally') {
      const legion = application.allianceLegion ?? application.legion;
      if (!tierAtLeast(actor.tier, 'commander')) {
        return rejected(t.newAllianceNeedsCommander(legion));
      }
      const created = await this.deps.alliances.add(actor, legion);
      if (created.status !== 'ok') return created;
      standing = approvedStanding('ally', legion, alliances());
    }
    return standing
      ? { status: 'ok', value: standing }
      : rejected(t.newAllianceNeedsCommander(application.allianceLegion ?? ''));
  }

  /** Sets the standing inside the decision's audited action; a refusal here is unexpected. */
  private async moveTo(actor: Actor, member: GuildMember, to: Standing): Promise<void> {
    const outcome = await this.deps.members.move(actor, member.id, to, {
      action: MOVE_ACTION[to.kind],
      preview: (name, from) => `${from} → ${this.deps.members.standingName(to)}: ${name}`,
      done: (name) => name,
      restriction: { origin: 'check', reason: ptBR.legionCheck.restrictReason },
    });
    if (outcome.status !== 'ok') {
      throw new Error(`could not set ${this.deps.members.standingName(to)}: ${outcome.status}`);
    }
  }

  /** The welcome for whoever came in through the form, in their thread (or announceChannel). */
  private async welcome(application: Application, nickname: string | null): Promise<void> {
    const recruitment = this.settings().recruitment;
    if (!recruitment) return;
    const announce = recruitment.announceChannel
      ? this.deps.directory.channelByKey(recruitment.announceChannel)
      : await this.cardChannel(application);
    const { legion } = this.settings().characters;
    const chatKey = this.settings().alliances.channel;
    const content =
      application.kind === 'ally'
        ? t.welcomeAlly(
            application.userId,
            application.allianceLegion ?? application.legion,
            (chatKey && this.deps.directory.channelByKey(chatKey)?.id) || null,
          )
        : application.kind === 'partner'
          ? t.welcomePartner(application.userId)
          : t.welcome(application.userId, legion, nickname, sameLegion(application.legion, legion));
    await announce?.send({ content, allowedMentions: { users: [application.userId] } });
  }

  /** Re-renders the application's card where it was posted (buttons go once it is decided). */
  private async refreshCard(application: Application): Promise<void> {
    if (!application.messageId) return;
    const channel = await this.cardChannel(application);
    const message = await channel?.messages.fetch(application.messageId);
    await message?.edit({ ...(await this.card(application)), allowedMentions: { parse: [] } });
  }

  /** "⚔️ Membro"… for replies. */
  kindName(application: Application): string {
    return kindText(application.kind, application.allianceLegion);
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
