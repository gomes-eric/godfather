import type { Guild, GuildMember } from 'discord.js';
import { classRoles, type RoleConfig } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { matchClass, type CharacterProfile } from '../core/game-character.js';
import { normalizeGameName } from '../core/registration.js';
import type { CharacterStore } from '../db/characters.js';
import { registerCharacter } from '../discord/character-registration.js';
import type { GuildDirectory } from '../discord/directory.js';
import { fetchMember, memberTier } from '../discord/members.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import { GameApiError, type GameCharacterService } from './game-character.service.js';
import type { LegionCheckService } from './legion-check.service.js';
import type { MemberService } from './member.service.js';

const t = ptBR.registration;

interface Deps {
  guild: Guild;
  config: ConfigStore;
  directory: GuildDirectory;
  registrations: CharacterStore;
  characters: GameCharacterService;
  members: MemberService;
  legion: LegionCheckService;
  runAction: ActionRunner;
  logger: Logger;
}

/**
 * Ties a member to their in-game character: class role, "⚔️ Nome" nickname, the stored character
 * (for /perfil, the daily check and #ranking), and Soldado for a Visitante. Used when an
 * application is approved and when an officer registers someone by hand.
 */
export class RegistrationService {
  constructor(private readonly deps: Deps) {}

  /** The class role for the game's class name, e.g. "Clérigo". */
  classRole(className: string): RoleConfig | undefined {
    return matchClass(className, classRoles(this.deps.config.get()));
  }

  /** The character with this exact name on the legion's server, read fresh from the site. */
  async lookup(name: string): Promise<CharacterProfile | null> {
    const ref = await this.deps.characters.find(normalizeGameName(name), true);
    return ref && this.deps.characters.profile(ref, true);
  }

  /**
   * Applies the character to the member and makes a Visitante a Soldado (an audited promotion by
   * `actor`). Runs inside the caller's audited action; returns the nickname set, if any.
   */
  async admit(
    actor: Actor,
    member: GuildMember,
    character: CharacterProfile,
    classRole: RoleConfig,
    reason: string,
  ): Promise<{ nickname: string | null; promoted: boolean }> {
    const { directory, registrations, members, legion, logger } = this.deps;
    const nickname = await registerCharacter(
      { directory, registrations },
      member,
      character,
      classRole,
      reason,
    );
    let promoted = false;
    if (memberTier(member, directory) === 'visitor') {
      const outcome = await members.promote(actor, member.id, 'soldier');
      promoted = outcome.status === 'ok';
    }
    legion
      .refreshRanking()
      .catch((error: unknown) => logger.warn({ err: error }, 'ranking refresh failed'));
    return { nickname, promoted };
  }

  /** An officer registering a member's character by hand (MCP `register_character`). */
  async register(
    actor: Actor,
    userId: string,
    characterName: string,
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
