import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import type { ApplicationKind, FormKind } from '../core/application-rules.js';
import type { CharacterProfile } from '../core/game-character.js';
import type { Application, ApplicationCharacter, ApplicationStore } from '../db/applications.js';
import { ptBR } from '../i18n/pt-BR.js';

const t = ptBR.recruitment;

export interface ApplicationInput {
  picked: FormKind;
  kind: ApplicationKind;
  character: CharacterProfile | null;
  allianceLegion: string | null;
  characterTakenBy: string | null;
}

export interface ReviewInput {
  userId: string;
  kind: ApplicationKind;
  character: CharacterProfile;
  allianceLegion: string | null;
  previousStanding: string;
}

function storedCharacter(c: CharacterProfile | null): ApplicationCharacter | null {
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

export class RecruitmentService {
  constructor(
    private readonly deps: {
      store: ApplicationStore;
      runAction: ActionRunner;
    },
  ) {}

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
          character: storedCharacter(input.character),
          kind: input.kind,
          requestedKind: input.picked,
          allianceLegion: input.allianceLegion,
          characterTakenBy: input.characterTakenBy,
        }),
    });
  }

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
          character: storedCharacter(input.character),
          kind: input.kind,
          requestedKind: input.kind,
          origin: 'check',
          allianceLegion: input.allianceLegion,
          previousStanding: input.previousStanding,
        }),
    });
  }

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
      action: 'recruit.kind',
      target: application.character?.name ?? application.userId,
      params: { userId: application.userId, from: application.kind, to: kind },
      preview: kind,
      execute: async () => {
        this.deps.store.setKind(id, kind, allianceLegion);
        return this.deps.store.get(id)!;
      },
    });
  }

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
      target: application.character?.name ?? application.userId,
      params: {
        userId: application.userId,
        kind: application.kind,
        decision: approve ? 'approved' : 'rejected',
      },
      preview: application.character?.name ?? application.userId,
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
