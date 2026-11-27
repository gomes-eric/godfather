import { rejected, type ActionRunner, type Rejected, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import type { CharacterRef, EquipmentItem, ItemDetail } from '../core/game-character.js';
import type { CharacterStore } from '../db/characters.js';
import { classRoles } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import { ownLegion } from '../config/views.js';
import { byCombatPower } from '../core/legion-check.js';
import { sameLegion } from '../core/game-character.js';
import { ptBR } from '../i18n/pt-BR.js';
import {
  GameApiError,
  type CharacterSheet,
  type GameCharacterService,
} from './game-character.service.js';

const t = ptBR.profile;

/** A character by its in-game name, or the one a member (maybe the actor) registered. */
export type CharacterTarget = { name: string } | { userId: string };

export type CharacterKey = Pick<CharacterRef, 'id' | 'serverId'>;

export type GearPiece = Pick<EquipmentItem, 'id' | 'slotPos' | 'enchantLevel'>;

export interface GearDetail {
  item: ItemDetail;
  characterName: string;
}

export interface RegisteredSummary {
  character: string;
  class: string;
  combatPower: number | null;
  itemLevel: number | null;
  legion: string | null;
  inLegion: boolean;
  member: string | null;
  userId: string;
  checkedAt: string | null;
}

type Found<T> = { status: 'ok'; value: T } | Rejected;

export class CharacterLookup {
  constructor(
    private readonly deps: {
      characters: GameCharacterService;
      registrations: CharacterStore;
      config: ConfigStore;
      /** How Discord shows the member, when they are still in the server. */
      memberName: (userId: string) => string | undefined;
      runAction: ActionRunner;
    },
  ) {}

  /** Every registered character, strongest first, as the last daily check saw it. */
  registered(actor: Actor): Promise<ServiceOutcome<RegisteredSummary[]>> {
    return this.deps.runAction({
      actor,
      action: 'character.read',
      preview: 'character.read',
      execute: async () => {
        const config = this.deps.config.get();
        const legion = ownLegion(config);
        const classes = new Map(classRoles(config).map((r) => [r.key, r.name]));
        return this.deps.registrations
          .all()
          .sort(byCombatPower)
          .map((row) => ({
            character: row.name,
            class: classes.get(row.classKey) ?? row.classKey,
            combatPower: row.combatPower,
            itemLevel: row.itemLevel,
            legion: row.legion || null,
            inLegion: sameLegion(row.legion, legion),
            member: this.deps.memberName(row.userId) ?? null,
            userId: row.userId,
            checkedAt: row.checkedAt?.toISOString() ?? null,
          }));
      },
    });
  }

  sheetFor(actor: Actor, target: CharacterTarget): Promise<ServiceOutcome<CharacterSheet>> {
    return this.read(actor, async () => {
      const key = await this.keyOf(actor, target);
      if ('status' in key) return key;
      return { status: 'ok', value: await this.deps.characters.sheet(key) };
    });
  }

  gearDetail(
    actor: Actor,
    character: CharacterKey,
    piece: GearPiece,
  ): Promise<ServiceOutcome<GearDetail>> {
    return this.read(actor, async () => {
      const [item, profile] = await Promise.all([
        this.deps.characters.item(character, piece),
        this.deps.characters.profile(character),
      ]);
      return { status: 'ok', value: { item, characterName: profile.name } };
    });
  }

  private async keyOf(actor: Actor, target: CharacterTarget): Promise<CharacterKey | Rejected> {
    if ('name' in target) {
      return (await this.deps.characters.find(target.name)) ?? rejected(t.notFound(target.name));
    }
    const registered = this.deps.registrations.get(target.userId);
    if (registered) return { id: registered.characterId, serverId: registered.serverId };
    return rejected(
      target.userId === actor.userId ? t.notRegistered : t.memberNotRegistered(target.userId),
    );
  }

  private async read<T>(actor: Actor, find: () => Promise<Found<T>>): Promise<ServiceOutcome<T>> {
    const outcome = await this.deps.runAction({
      actor,
      action: 'character.read',
      preview: 'character.read',
      execute: () =>
        find().catch((error: unknown) => {
          if (error instanceof GameApiError) return rejected(t.apiDown);
          throw error;
        }),
    });
    return outcome.status === 'ok' ? outcome.value : outcome;
  }
}
