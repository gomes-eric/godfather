import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { matchClass, type CharacterProfile } from '../core/game-character.js';
import type { Application, ApplicationStore } from '../db/applications.js';
import { ptBR } from '../i18n/pt-BR.js';

const t = ptBR.recruitment;

/**
 * Recruitment applications: a Visitante sends the form, officers approve or refuse it. The rules
 * live here; posting the cards and registering the character is the Discord adapter's job.
 */
export class RecruitmentService {
  constructor(
    private readonly deps: {
      config: ConfigStore;
      store: ApplicationStore;
      runAction: ActionRunner;
    },
  ) {}

  /** Records an application; refuses a second one while the first waits for a decision. */
  apply(
    actor: Actor,
    input: { character: CharacterProfile; reason: string; schedule: string },
  ): Promise<ServiceOutcome<Application>> {
    if (actor.tier !== 'visitor') return Promise.resolve(rejected(t.alreadyMember));
    if (this.deps.store.pendingFor(actor.userId))
      return Promise.resolve(rejected(t.alreadyPending));
    const c = input.character;
    return this.deps.runAction({
      actor,
      action: 'recruit.apply',
      target: c.name,
      params: { character: c.name },
      preview: c.name,
      execute: async () =>
        this.deps.store.create({
          userId: actor.userId,
          characterId: c.id,
          characterName: c.name,
          serverId: c.serverId,
          className: c.className,
          level: c.level,
          legion: c.legion,
          combatPower: c.combatPower,
          itemLevel: c.itemLevel,
          reason: input.reason,
          schedule: input.schedule,
        }),
    });
  }

  /**
   * An officer's decision. `onApprove` runs inside the audited action (register the character,
   * make them Soldado) before the application is marked approved.
   */
  decide(
    actor: Actor,
    id: number,
    approve: boolean,
    onApprove: (application: Application) => Promise<void> = async () => undefined,
  ): Promise<ServiceOutcome<Application>> {
    const application = this.deps.store.get(id);
    if (!application) return Promise.resolve(rejected(t.gone));
    if (application.status !== 'pending') return Promise.resolve(rejected(t.alreadyDecided));
    return this.deps.runAction({
      actor,
      action: 'recruit.decide',
      target: application.characterName,
      params: { userId: application.userId, decision: approve ? 'approved' : 'rejected' },
      preview: application.characterName,
      execute: async () => {
        if (approve) await onApprove(application);
        this.deps.store.decide(id, approve ? 'approved' : 'rejected', actor.userId);
        return this.deps.store.get(id)!;
      },
    });
  }

  attachMessage(id: number, messageId: string): void {
    this.deps.store.setMessage(id, messageId);
  }

  classRole(className: string) {
    return matchClass(
      className,
      this.deps.config.get().roles.filter((role) => role.class && role.emoji),
    );
  }
}
