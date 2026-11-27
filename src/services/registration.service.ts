import { classRoles, type RoleConfig } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { matchClass, type CharacterProfile } from '../core/game-character.js';
import type { ActionName } from '../core/permissions.js';
import { normalizeGameName } from '../core/registration.js';
import {
  RESTRICTED,
  SOLDIER,
  standingTier,
  type Standing,
  type StandingCause,
} from '../core/standing.js';
import type { CharacterStore } from '../db/characters.js';
import type { GuildDirectory } from '../discord/directory.js';
import { notifyOfficers } from '../discord/officer-notices.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import { GameApiError, type GameCharacterService } from './game-character.service.js';
import type { RankingBoard } from './ranking-board.service.js';
import type { Changed, Roster } from './roster.service.js';

const t = ptBR.registration;

interface Deps {
  config: ConfigStore;
  directory: GuildDirectory;
  registrations: CharacterStore;
  characters: GameCharacterService;
  roster: Roster;
  ranking: RankingBoard;
  runAction: ActionRunner;
  logger: Logger;
}

export interface LinkOptions {
  to?: Standing;
  cause: StandingCause;
  action?: ActionName;
}

export class RegistrationService {
  constructor(private readonly deps: Deps) {}

  classRole(className: string): RoleConfig | undefined {
    return matchClass(className, classRoles(this.deps.config.get()));
  }

  async lookup(name: string): Promise<CharacterProfile | null> {
    const ref = await this.deps.characters.find(normalizeGameName(name), true);
    return ref && this.deps.characters.profile(ref, true);
  }

  async find(name: string): Promise<ServiceOutcome<CharacterProfile>> {
    try {
      const character = await this.lookup(name);
      return character
        ? { status: 'ok', value: character }
        : rejected(ptBR.recruitment.notFound(normalizeGameName(name)));
    } catch (error) {
      if (!(error instanceof GameApiError)) throw error;
      return rejected(ptBR.profile.apiDown);
    }
  }

  storedName(userId: string): string | undefined {
    return this.deps.registrations.get(userId)?.name;
  }

  ownerOf(characterId: string, userId: string): string | undefined {
    const row = this.deps.registrations.byCharacter(characterId);
    return row && row.userId !== userId ? row.userId : undefined;
  }

  async link(
    actor: Actor,
    userId: string,
    character: CharacterProfile,
    options: LinkOptions,
  ): Promise<ServiceOutcome<Changed>> {
    const classRole = this.classRole(character.className);
    if (!classRole) return rejected(t.noClassRole(character.className));
    const previousOwner = this.ownerOf(character.id, userId);
    if (previousOwner) await this.takeFrom(actor, previousOwner, userId, character.name);

    const outcome = await this.deps.roster.change(actor, userId, {
      ...(options.to && { to: options.to }),
      ...(options.action && { action: options.action }),
      character: { classKey: classRole.key, gameName: character.name },
      cause: options.cause,
    });
    if (outcome.status !== 'ok') return outcome;

    this.deps.registrations.save({
      userId,
      characterId: character.id,
      name: character.name,
      serverId: character.serverId,
      classKey: classRole.key,
      legion: character.legion,
      combatPower: character.combatPower,
      itemLevel: character.itemLevel,
    });
    this.deps.ranking
      .refresh()
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, 'ranking refresh failed'));
    return outcome;
  }

  private async takeFrom(
    actor: Actor,
    oldOwner: string,
    newOwner: string,
    character: string,
  ): Promise<void> {
    this.deps.registrations.delete(oldOwner);
    const outcome = await this.deps.roster.change(actor, oldOwner, {
      to: RESTRICTED,
      cause: { kind: 'transfer', character },
    });
    if (outcome.status !== 'ok' && outcome.status !== 'rejected') {
      this.deps.logger.warn({ user: oldOwner, outcome }, 'could not restrict the old owner');
    }
    await notifyOfficers(this.deps, t.transferred(character, oldOwner, newOwner));
  }

  async register(
    actor: Actor,
    userId: string,
    characterName: string,
    confirm = false,
  ): Promise<ServiceOutcome<string>> {
    const member = await this.deps.roster.member(userId);
    if (!member) return rejected(ptBR.members.notMember);
    const found = await this.find(characterName);
    if (found.status !== 'ok') return found;
    const character = found.value;
    if (!this.classRole(character.className)) {
      return rejected(t.noClassRole(character.className));
    }

    const owner = this.ownerOf(character.id, userId);
    if (owner && !confirm) {
      await notifyOfficers(this.deps, t.takenAttempt(character.name, owner, userId, actor.userId));
      return rejected(t.takenNeedsConfirm(character.name, owner));
    }
    const promote = standingTier(member.standing) === 'visitor';
    const linked = await this.link(actor, userId, character, {
      ...(promote && { to: SOLDIER }),
      cause: { kind: 'officer', reason: null },
      action: 'member.register',
    });
    if (linked.status !== 'ok') return linked;
    return {
      status: 'ok',
      value: t.done(member.displayName, character.name, linked.value.nickname, promote),
    };
  }
}
