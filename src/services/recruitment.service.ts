import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import { systemActor, type Actor } from '../core/actor.js';
import {
  approvedStanding,
  isNewAlliance,
  planApplication,
  resolveKind,
  type ApplicationKind,
  type FormKind,
} from '../core/application-rules.js';
import { sameLegion, type CharacterProfile } from '../core/game-character.js';
import { authorize } from '../core/permissions.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import {
  decodeStanding,
  encodeStanding,
  SOLDIER,
  type Standing,
  type StandingCause,
} from '../core/standing.js';
import { tierAtLeast } from '../core/tiers.js';
import type { Application, ApplicationCharacter, ApplicationStore } from '../db/applications.js';
import type { GuildDirectory } from '../discord/directory.js';
import { notifyOfficers } from '../discord/officer-notices.js';
import { kindText } from '../discord/recruitment.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import type { AllianceService } from './alliance.service.js';
import type { ApplicationView, RecruitmentBoard } from './recruitment-board.js';
import type { RegistrationService } from './registration.service.js';
import type { Roster } from './roster.service.js';
import { allianceChatKey, ownLegion } from '../config/views.js';

const t = ptBR.recruitment;

/** How long a decided application's private thread stays before it is deleted. */
export const THREAD_LIFETIME_MS = { approved: 60 * 60_000, rejected: 6 * 60 * 60_000 } as const;
const SWEEP_MS = 5 * 60_000;

interface Deps {
  store: ApplicationStore;
  board: RecruitmentBoard;
  roster: Roster;
  registration: RegistrationService;
  alliances: AllianceService;
  config: ConfigStore;
  directory: GuildDirectory;
  runAction: ActionRunner;
  botUserId: string;
  logger: Logger;
  now?: () => Date;
}

/** What someone sent with "Enviar minha ficha". */
export interface SentForm {
  picked: FormKind;
  characterName: string | null;
}

/** The daily check changed someone's standing (or saw an Oficial leave) and asks the officers. */
export interface ReviewRequest {
  userId: string;
  kind: ApplicationKind;
  character: CharacterProfile;
  allianceLegion: string | null;
  previous: Standing;
}

export interface ApplicationSummary {
  id: number;
  status: Application['status'];
  kind: ApplicationKind;
  picked: ApplicationKind;
  origin: Application['origin'];
  allianceLegion: string | null;
  character: ApplicationCharacter | null;
  member: string;
  characterTakenBy: string | null;
  createdAt: Date;
  decidedBy: string | null;
}

/** What a decision will do, settled before anything changes. */
interface DecisionPlan {
  target: Standing | null;
  /** An Aliança of a legion that is not an alliance yet: created first, by a Comandante. */
  newAllianceLegion: string | null;
  character: CharacterProfile | null;
}

class DecisionFailed extends Error {
  constructor(readonly reason: ServiceOutcome<never>) {
    super('recruitment decision failed');
  }
}

function characterOf(application: Application): CharacterProfile | null {
  return application.character && { ...application.character, title: null, avatarUrl: null };
}

function stored(c: CharacterProfile | null): ApplicationCharacter | null {
  return (
    c && {
      id: c.id,
      name: c.name,
      serverId: c.serverId,
      className: c.className,
      level: c.level,
      legion: c.legion,
      combatPower: c.combatPower,
      itemLevel: c.itemLevel,
    }
  );
}

/**
 * Recruitment applications from "Enviar minha ficha" and the daily check's reviews: one module
 * owns them, decides each one in full before changing anything, and shows them through the board.
 */
export class Recruitment implements BackgroundJob {
  private readonly deciding = new Set<number>();

  constructor(private readonly deps: Deps) {}

  private alliances() {
    return this.deps.config.get().alliances;
  }

  private legion(): string {
    return ownLegion(this.deps.config.get());
  }

  /** Why the form can't be opened for them now, if it can't. */
  canApply(actor: Actor): string | null {
    if (actor.tier !== 'visitor') return t.alreadyMember;
    if (this.deps.store.pendingFor(actor.userId)) return t.alreadyPending;
    return null;
  }

  /** Their registered character's name, to pre-fill the form. */
  formDefaults(userId: string): { characterName: string | undefined } {
    return { characterName: this.deps.registration.storedName(userId) };
  }

  kindName(application: Pick<Application, 'kind' | 'allianceLegion'>): string {
    return kindText(application.kind, application.allianceLegion);
  }

  private async view(application: Application): Promise<ApplicationView> {
    const member = await this.deps.roster.member(application.userId);
    const className = application.character?.className;
    const classRole = className ? this.deps.registration.classRole(className) : undefined;
    return {
      application,
      look: {
        classEmoji: classRole?.emoji ?? '🎮',
        avatarUrl: member?.avatarUrl ?? null,
        legionName: this.legion(),
        applicantName: member?.displayName ?? application.userId,
        newAlliance: isNewAlliance(application.kind, application.allianceLegion, this.alliances()),
        previousStanding: application.previousStanding
          ? this.deps.roster.standingName(decodeStanding(application.previousStanding))
          : null,
      },
    };
  }

  private async post(application: Application, ping: boolean): Promise<Application> {
    const posted = await this.deps.board.post(await this.view(application), { ping });
    if (!posted) return application;
    this.deps.store.setMessage(application.id, posted.messageId, posted.threadId);
    return this.deps.store.get(application.id)!;
  }

  private async refresh(application: Application): Promise<void> {
    await this.deps.board
      .refresh(await this.view(application))
      .catch((error: unknown) =>
        this.deps.logger.warn({ err: error, application: application.id }, 'card not updated'),
      );
  }

  /**
   * Records the form and posts its card in a private thread. A Membro whose character is already
   * in the legion (and nobody else's) is approved right away.
   */
  async submit(
    actor: Actor,
    form: SentForm,
  ): Promise<
    ServiceOutcome<{ application: Application; autoApproved: boolean; shownName: string }>
  > {
    const problem = this.canApply(actor);
    if (problem) return rejected(problem);

    let character: CharacterProfile | null = null;
    if (form.characterName) {
      const found = await this.deps.registration.find(form.characterName);
      if (found.status !== 'ok') return found;
      character = found.value;
    }
    const owner = character
      ? this.deps.registration.ownerOf(character.id, actor.userId)
      : undefined;
    const restriction = this.deps.roster.restrictionOf(actor.userId);
    const plan = planApplication({
      picked: form.picked,
      character,
      legion: this.legion(),
      alliances: this.alliances(),
      takenBySomeoneElse: owner !== undefined,
      restrictionNeedsOfficer: restriction === 'officer' || restriction === 'transfer',
    });
    if ('refusal' in plan) return rejected(t[plan.refusal]);

    const created = await this.deps.runAction({
      actor,
      action: 'recruit.apply',
      target: character?.name ?? actor.userId,
      params: { kind: plan.kind, character: character?.name ?? null },
      preview: character?.name ?? actor.userId,
      execute: async () =>
        this.deps.store.create({
          userId: actor.userId,
          character: stored(character),
          kind: plan.kind,
          requestedKind: form.picked,
          allianceLegion: plan.allianceLegion,
          characterTakenBy: owner ?? null,
        }),
    });
    if (created.status !== 'ok') return created;
    const shownName =
      character?.name ?? (await this.deps.roster.member(actor.userId))?.displayName ?? actor.userId;
    const application = await this.post(created.value, !plan.autoApprove);

    if (plan.autoApprove) {
      const decided = await this.decide(systemActor(this.deps.botUserId), application.id, true);
      if (decided.status === 'ok') {
        await notifyOfficers(
          this.deps,
          t.autoApprovedNotice(actor.userId, character!.name, this.legion()),
        );
        return {
          status: 'ok',
          value: { application: decided.value, autoApproved: true, shownName },
        };
      }
      this.deps.logger.warn({ application: application.id, decided }, 'auto-approval failed');
      await notifyOfficers(this.deps, t.autoApprovalFailed(actor.userId, character!.name));
      return { status: 'ok', value: { application, autoApproved: false, shownName } };
    }

    if (owner && character) {
      await notifyOfficers(this.deps, t.duplicateNotice(actor.userId, character.name, owner));
    }
    return { status: 'ok', value: { application, autoApproved: false, shownName } };
  }

  /** A card in a private thread in the officers' channel; Recusar puts the old standing back. */
  async openReview(request: ReviewRequest): Promise<void> {
    const created = await this.deps.runAction({
      actor: systemActor(this.deps.botUserId),
      action: 'recruit.apply',
      target: request.character.name,
      params: { kind: request.kind, origin: 'check' },
      preview: request.character.name,
      execute: async () =>
        this.deps.store.create({
          userId: request.userId,
          character: stored(request.character),
          kind: request.kind,
          requestedKind: request.kind,
          origin: 'check',
          allianceLegion: request.allianceLegion,
          previousStanding: encodeStanding(request.previous),
        }),
    });
    if (created.status === 'ok') await this.post(created.value, true);
  }

  /** The application Mudar works on, when the officer may change it. */
  kindChoices(actor: Actor, id: number): ServiceOutcome<Application> {
    const application = this.deps.store.get(id);
    if (!application) return rejected(t.gone);
    if (application.status !== 'pending') return rejected(t.alreadyDecided);
    const authorization = authorize(actor.tier, 'recruit.kind');
    if (!authorization.allowed) {
      return { status: 'denied', requiredTier: authorization.requiredTier };
    }
    return { status: 'ok', value: application };
  }

  /** Mudar: the type approving will give. Aliança takes the character's legion. */
  async changeKind(
    actor: Actor,
    id: number,
    kind: ApplicationKind,
  ): Promise<ServiceOutcome<Application>> {
    const application = this.deps.store.get(id);
    if (!application) return rejected(t.gone);
    if (application.status !== 'pending') return rejected(t.alreadyDecided);
    const resolved = resolveKind(application, kind, this.alliances());
    if ('refusal' in resolved) return rejected(t[resolved.refusal]);

    const outcome = await this.deps.runAction({
      actor,
      action: 'recruit.kind',
      target: application.character?.name ?? application.userId,
      params: { userId: application.userId, from: application.kind, to: resolved.kind },
      preview: resolved.kind,
      execute: async () => {
        this.deps.store.setKind(id, resolved.kind, resolved.allianceLegion);
        return this.deps.store.get(id)!;
      },
    });
    if (outcome.status === 'ok') await this.refresh(outcome.value);
    return outcome;
  }

  /**
   * Approves or refuses an application. Every check runs first (still pending, rank, the person
   * and the roles they need); only then is a new alliance created and the standing changed. One
   * decision per application at a time.
   */
  async decide(actor: Actor, id: number, approve: boolean): Promise<ServiceOutcome<Application>> {
    if (this.deciding.has(id)) return rejected(t.beingDecided);
    this.deciding.add(id);
    try {
      return await this.decideOnce(actor, id, approve);
    } finally {
      this.deciding.delete(id);
    }
  }

  private async decideOnce(
    actor: Actor,
    id: number,
    approve: boolean,
  ): Promise<ServiceOutcome<Application>> {
    const application = this.deps.store.get(id);
    if (!application) return rejected(t.gone);
    if (application.status !== 'pending') return rejected(t.alreadyDecided);
    const authorization = authorize(actor.tier, 'recruit.decide');
    if (!authorization.allowed) {
      return { status: 'denied', requiredTier: authorization.requiredTier };
    }

    const planned = await this.plan(actor, application, approve);
    if (planned.status !== 'ok') return planned;
    const plan = planned.value;
    let target = plan.target;
    if (plan.newAllianceLegion) {
      const created = await this.deps.alliances.add(actor, plan.newAllianceLegion);
      if (created.status !== 'ok') return created;
      target = approvedStanding('ally', plan.newAllianceLegion, this.alliances()) ?? null;
      if (!target) return rejected(t.newAllianceNeedsCommander(plan.newAllianceLegion));
    }

    let nickname: string | null = null;
    let outcome: ServiceOutcome<Application>;
    try {
      outcome = await this.deps.runAction({
        actor,
        action: 'recruit.decide',
        target: application.character?.name ?? application.userId,
        params: {
          userId: application.userId,
          kind: application.kind,
          decision: approve ? 'approved' : 'rejected',
        },
        preview: application.character?.name ?? application.userId,
        execute: async () => {
          if (target)
            nickname = await this.apply(actor, application.userId, target, plan.character);
          this.deps.store.decide(id, approve ? 'approved' : 'rejected', actor.userId);
          return this.deps.store.get(id)!;
        },
      });
    } catch (error) {
      if (error instanceof DecisionFailed) return error.reason;
      throw error;
    }
    if (outcome.status !== 'ok') return outcome;

    await this.refresh(outcome.value);
    if (outcome.value.status === 'approved' && outcome.value.origin === 'form') {
      await this.deps.board
        .say(outcome.value, this.welcome(outcome.value, nickname))
        .catch((error: unknown) =>
          this.deps.logger.warn({ err: error, application: id }, 'welcome not posted'),
        );
    }
    return outcome;
  }

  private async plan(
    actor: Actor,
    application: Application,
    approve: boolean,
  ): Promise<ServiceOutcome<DecisionPlan>> {
    const needsMember = approve || application.origin === 'check';
    const member = needsMember ? await this.deps.roster.member(application.userId) : null;
    if (needsMember && !member) return rejected(t.leftServer);
    const settle = (to: Standing) => this.deps.roster.check(actor, application.userId, to);

    if (!approve) {
      if (application.origin !== 'check' || !application.previousStanding) {
        return { status: 'ok', value: { target: null, newAllianceLegion: null, character: null } };
      }
      const previous = decodeStanding(application.previousStanding);
      const refusal = await settle(previous);
      return refusal
        ? rejected(refusal)
        : { status: 'ok', value: { target: previous, newAllianceLegion: null, character: null } };
    }

    const character = application.origin === 'form' ? characterOf(application) : null;
    if (character && !this.deps.registration.classRole(character.className)) {
      return rejected(ptBR.registration.noClassRole(character.className));
    }
    const standing = approvedStanding(
      application.kind,
      application.allianceLegion,
      this.alliances(),
    );
    if (standing) {
      const refusal = await settle(standing);
      return refusal
        ? rejected(refusal)
        : { status: 'ok', value: { target: standing, newAllianceLegion: null, character } };
    }

    const legion = application.allianceLegion ?? application.character?.legion ?? '';
    if (!tierAtLeast(actor.tier, 'commander')) return rejected(t.newAllianceNeedsCommander(legion));
    if (!this.deps.directory.standingRoles().ally) return rejected(ptBR.members.noAllyRole);
    const allyStandsAsSoldier = SOLDIER;
    const refusal = await settle(allyStandsAsSoldier);
    return refusal
      ? rejected(refusal)
      : { status: 'ok', value: { target: null, newAllianceLegion: legion, character } };
  }

  /** The standing (and the character, for a form) in one roster change; returns the nickname. */
  private async apply(
    actor: Actor,
    userId: string,
    target: Standing,
    character: CharacterProfile | null,
  ): Promise<string | null> {
    const cause: StandingCause = { kind: 'recruitment' };
    const result = character
      ? await this.deps.registration.link(actor, userId, character, { to: target, cause })
      : await this.deps.roster.change(actor, userId, { to: target, cause });
    if (result.status !== 'ok') throw new DecisionFailed(result);
    return result.value.nickname;
  }

  private welcome(application: Application, nickname: string | null): string {
    if (application.kind === 'ally') {
      const chatKey = allianceChatKey(this.deps.config.get());
      return t.welcomeAlly(
        application.userId,
        application.allianceLegion ?? application.character?.legion ?? '',
        (chatKey && this.deps.directory.channelByKey(chatKey)?.id) || null,
      );
    }
    if (application.kind === 'partner') return t.welcomePartner(application.userId);
    const legion = this.legion();
    return t.welcome(
      application.userId,
      legion,
      nickname,
      sameLegion(application.character?.legion ?? '', legion),
    );
  }

  /** Applications for officers, newest first, with names already resolved. */
  list(
    actor: Actor,
    status?: Application['status'],
  ): Promise<ServiceOutcome<ApplicationSummary[]>> {
    return this.deps.runAction({
      actor,
      action: 'recruit.read',
      preview: 'recruit.read',
      execute: async () =>
        this.deps.store.list(status).map((a) => ({
          id: a.id,
          status: a.status,
          kind: a.kind,
          picked: a.requestedKind,
          origin: a.origin,
          allianceLegion: a.allianceLegion,
          character: a.character,
          member: this.deps.roster.displayName(a.userId),
          characterTakenBy: a.characterTakenBy
            ? this.deps.roster.displayName(a.characterTakenBy)
            : null,
          createdAt: a.createdAt,
          decidedBy: a.decidedBy,
        })),
    });
  }

  /**
   * Deletes the private thread of each decided application once its time is up: an hour after an
   * approval, six hours after a refusal, counted from the stored decision time.
   */
  async sweepThreads(): Promise<number> {
    const now = (this.deps.now ?? (() => new Date()))().getTime();
    let deleted = 0;
    for (const application of this.deps.store.decidedWithThread()) {
      if (application.status === 'pending' || !application.decidedAt) continue;
      if (now - application.decidedAt.getTime() < THREAD_LIFETIME_MS[application.status]) continue;
      if (await this.deps.board.deleteThread(application.threadId!)) deleted++;
      this.deps.store.forgetThread(application.id);
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
