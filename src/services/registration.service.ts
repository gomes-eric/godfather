import type { Guild, GuildMember } from 'discord.js';
import { classRoles, type RoleConfig } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { RESTRICTED } from '../core/standing.js';
import { matchClass, type CharacterProfile } from '../core/game-character.js';
import { normalizeGameName } from '../core/registration.js';
import type { CharacterStore } from '../db/characters.js';
import { registerCharacter } from '../discord/character-registration.js';
import type { GuildDirectory } from '../discord/directory.js';
import { fetchMember, memberTier } from '../discord/members.js';
import { notifyOfficers } from '../discord/officer-notices.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import { GameApiError, type GameCharacterService } from './game-character.service.js';
import type { RankingBoard } from './ranking-board.service.js';
import type { MemberService } from './member.service.js';

const t = ptBR.registration;

interface Deps {
  guild: Guild;
  config: ConfigStore;
  directory: GuildDirectory;
  registrations: CharacterStore;
  characters: GameCharacterService;
  members: MemberService;
  ranking: RankingBoard;
  runAction: ActionRunner;
  logger: Logger;
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

  ownerOf(characterId: string, userId: string): string | undefined {
    const row = this.deps.registrations.byCharacter(characterId);
    return row && row.userId !== userId ? row.userId : undefined;
  }

  async link(
    actor: Actor,
    member: GuildMember,
    character: CharacterProfile,
    classRole: RoleConfig,
    reason: string,
  ): Promise<string | null> {
    const { directory, registrations, ranking, logger } = this.deps;
    const previousOwner = this.ownerOf(character.id, member.id);
    if (previousOwner) await this.takeFrom(actor, previousOwner, member.id, character.name);
    const nickname = await registerCharacter(
      { directory, registrations },
      member,
      character,
      classRole,
      reason,
    );
    ranking
      .refresh()
      .catch((error: unknown) => logger.warn({ err: error }, 'ranking refresh failed'));
    return nickname;
  }

  private async takeFrom(
    actor: Actor,
    oldOwner: string,
    newOwner: string,
    character: string,
  ): Promise<void> {
    this.deps.registrations.delete(oldOwner);
    if (await fetchMember(this.deps.guild, oldOwner)) {
      const outcome = await this.deps.members.move(actor, oldOwner, RESTRICTED, {
        action: 'member.restrict',
        preview: (name, from) =>
          ptBR.members.restrictPreview(name, from, t.transferReason(character)),
        done: ptBR.members.restricted,
        restriction: { origin: 'transfer', reason: t.transferReason(character) },
      });
      if (outcome.status !== 'ok') {
        this.deps.logger.warn({ user: oldOwner, outcome }, 'could not restrict the old owner');
      }
    }
    await notifyOfficers(this.deps, t.transferred(character, oldOwner, newOwner));
  }

  async admit(
    actor: Actor,
    member: GuildMember,
    character: CharacterProfile,
    classRole: RoleConfig,
    reason: string,
  ): Promise<{ nickname: string | null; promoted: boolean }> {
    const nickname = await this.link(actor, member, character, classRole, reason);
    let promoted = false;
    if (memberTier(member, this.deps.directory) === 'visitor') {
      const outcome = await this.deps.members.promote(actor, member.id, 'soldier');
      promoted = outcome.status === 'ok';
    }
    return { nickname, promoted };
  }

  async register(
    actor: Actor,
    userId: string,
    characterName: string,
    confirm = false,
  ): Promise<ServiceOutcome<string>> {
    const member = await fetchMember(this.deps.guild, userId);
    if (!member) return rejected(ptBR.members.notMember);

    let character: CharacterProfile | null;
    try {
      character = await this.lookup(characterName);
    } catch (error) {
      if (!(error instanceof GameApiError)) throw error;
      return rejected(ptBR.profile.apiDown);
    }
    if (!character) return rejected(ptBR.recruitment.notFound(normalizeGameName(characterName)));
    const classRole = this.classRole(character.className);
    if (!classRole) return rejected(t.noClassRole(character.className));

    const found = character;
    const name = member.displayName;
    const owner = this.ownerOf(found.id, member.id);
    if (owner && !confirm) {
      await notifyOfficers(this.deps, t.takenAttempt(found.name, owner, member.id, actor.userId));
      return rejected(t.takenNeedsConfirm(found.name, owner));
    }
    const officer = (await fetchMember(this.deps.guild, actor.userId))?.displayName;
    return this.deps.runAction({
      actor,
      action: 'member.register',
      target: name,
      params: { userId: member.id, character: found.name, class: classRole.key },
      preview: t.preview(name, found.name),
      execute: async () => {
        const { nickname, promoted } = await this.admit(
          actor,
          member,
          found,
          classRole,
          t.reason(officer ?? actor.userId),
        );
        return t.done(name, found.name, nickname, promoted);
      },
    });
  }
}
