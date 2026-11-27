import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import type { ApplicationKind, FormKind } from '../core/application-rules.js';
import type { CharacterProfile } from '../core/game-character.js';
import type { Application, ApplicationStore } from '../db/applications.js';
import { ptBR } from '../i18n/pt-BR.js';

const t = ptBR.recruitment;

/** What a sent form records. */
export interface ApplicationInput {
  picked: FormKind;
  kind: ApplicationKind;
  character: CharacterProfile | null;
  allianceLegion: string | null;
  duplicateOf: string | null;
}

/** What the daily check records when it opens a review for the officers. */
export interface ReviewInput {
  userId: string;
  kind: ApplicationKind;
  character: CharacterProfile;
  allianceLegion: string | null;
  previousStanding: string;
}

function characterColumns(c: CharacterProfile | null) {
  return {
    characterId: c?.id ?? null,
    characterName: c?.name ?? null,
    serverId: c?.serverId ?? null,
    className: c?.className ?? null,
    level: c?.level ?? null,
    legion: c?.legion ?? '',
    combatPower: c?.combatPower ?? null,
    itemLevel: c?.itemLevel ?? null,
  };
}

/**
 * Recruitment applications: a Visitante sends the form, officers approve or refuse it, and the
 * daily check opens reviews of its own. The rules live here; posting the cards and carrying out
 * a decision is RecruitmentDesk's job.
 */
export class RecruitmentService {
  constructor(
    private readonly deps: {
      store: ApplicationStore;
      runAction: ActionRunner;
    },
  ) {}

  /** Records an application; refuses a second one while the first waits for a decision. */
  apply(actor: Actor, input: ApplicationInput): Promise<ServiceOutcome<Application>> {
    if (actor.tier !== 'visitor') return Promise.resolve(rejected(t.alreadyMember));
    if (this.deps.store.pendingFor(actor.userId))
      return Promise.resolve(rejected(t.alreadyPending));
    const name = input.character?.name ?? actor.userId;
    return this.deps.runAction({
      actor,
      action: 'recruit.apply',
      target: name,
      params: { kind: input.kind, character: input.character?.name ?? null },
      preview: name,
      execute: async () =>
        this.deps.store.create({
          userId: actor.userId,
          ...characterColumns(input.character),
          kind: input.kind,
          requestedKind: input.picked,
          allianceLegion: input.allianceLegion,
          duplicateOf: input.duplicateOf,
        }),
    });
  }

  /** A review the daily check opens after changing someone's standing (or for an Oficial). */
  openReview(actor: Actor, input: ReviewInput): Promise<ServiceOutcome<Application>> {
    return this.deps.runAction({
      actor,
      action: 'recruit.apply',
      target: input.character.name,
      params: { kind: input.kind, origin: 'check' },
      preview: input.character.name,
      execute: async () =>
        this.deps.store.create({
          userId: input.userId,
          ...characterColumns(input.character),
          kind: input.kind,
          requestedKind: input.kind,
          origin: 'check',
          allianceLegion: input.allianceLegion,
          previousStanding: input.previousStanding,
        }),
    });
  }

  /** Mudar: what approving the application will do. */
  changeKind(
    actor: Actor,
    id: number,
    kind: ApplicationKind,
    allianceLegion: string | null,
  ): Promise<ServiceOutcome<Application>> {
    const application = this.deps.store.get(id);
    if (!application) return Promise.resolve(rejected(t.gone));
    if (application.status !== 'pending') return Promise.resolve(rejected(t.alreadyDecided));
    return this.deps.runAction({
      actor,
      action: 'recruit.edit',
      target: application.characterName ?? application.userId,
      params: { userId: application.userId, from: application.kind, to: kind },
      preview: kind,
      execute: async () => {
        this.deps.store.setKind(id, kind, allianceLegion);
        return this.deps.store.get(id)!;
      },
    });
  }

  /**
   * An officer's decision. `carryOut` runs inside the audited action (register the character,
   * set the standing, or put the previous one back) before the application is marked decided.
   */
  decide(
    actor: Actor,
    id: number,
    approve: boolean,
    carryOut: (application: Application) => Promise<void>,
  ): Promise<ServiceOutcome<Application>> {
    const application = this.deps.store.get(id);
    if (!application) return Promise.resolve(rejected(t.gone));
    if (application.status !== 'pending') return Promise.resolve(rejected(t.alreadyDecided));
    return this.deps.runAction({
      actor,
      action: 'recruit.decide',
      target: application.characterName ?? application.userId,
      params: {
        userId: application.userId,
        kind: application.kind,
        decision: approve ? 'approved' : 'rejected',
      },
      preview: application.characterName ?? application.userId,
      execute: async () => {
        await carryOut(application);
        this.deps.store.decide(id, approve ? 'approved' : 'rejected', actor.userId);
        return this.deps.store.get(id)!;
      },
    });
  }

  attachMessage(id: number, messageId: string, threadId: string | null = null): void {
    this.deps.store.setMessage(id, messageId, threadId);
  }
}
