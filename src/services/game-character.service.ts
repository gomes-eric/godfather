import type { ConfigStore } from '../config/store.js';
import {
  parseEquipment,
  parseItemDetail,
  parseProfile,
  parseSearch,
  type CharacterProfile,
  type CharacterRef,
  type EquipmentItem,
  type ItemDetail,
} from '../core/game-character.js';
import type { Logger } from '../logger.js';
import { fetchJson, type FetchJson } from './fetch-json.js';

const SEARCH_URL = 'https://api-search.plaync.com/aion2global/search/v2/character';
const API_URL = 'https://aion2.plaync.com/api/character';
/** The game updates a profile when the character logs out; half an hour is fresh enough. */
const CACHE_MS = 30 * 60_000;

/** The official site didn't answer, or answered something unexpected. */
export class GameApiError extends Error {}

export interface CharacterSheet {
  profile: CharacterProfile;
  equipment: EquipmentItem[];
}

/**
 * Reads characters from the official Aion 2 site (aion2.plaync.com), the same public API shugo.gg
 * uses. Responses are cached, so repeated /perfil calls don't hit the site again.
 */
export class GameCharacterService {
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private readonly fetchJson: FetchJson;
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      config: ConfigStore;
      logger: Logger;
      fetchJson?: FetchJson;
      now?: () => number;
    },
  ) {
    this.fetchJson = deps.fetchJson ?? fetchJson;
    this.now = deps.now ?? Date.now;
  }

  private get lookup() {
    return this.deps.config.get().settings.characters;
  }

  private async cached(url: string, fresh: boolean): Promise<unknown> {
    const hit = this.cache.get(url);
    if (!fresh && hit && this.now() - hit.at < CACHE_MS) return hit.value;
    try {
      const value = await this.fetchJson(url);
      const now = this.now();
      for (const [key, entry] of this.cache) {
        if (now - entry.at >= CACHE_MS) this.cache.delete(key);
      }
      this.cache.set(url, { at: now, value });
      return value;
    } catch (error) {
      this.deps.logger.warn({ err: error, url }, 'Aion 2 character API request failed');
      throw error instanceof GameApiError ? error : new GameApiError(String(error));
    }
  }

  /** The character with exactly this name on the legion's server, or null. */
  async find(name: string, fresh = false): Promise<CharacterRef | null> {
    const { region, serverId } = this.lookup;
    const query = new URLSearchParams({
      keyword: name,
      page: '1',
      size: '20',
      localeInfo: 'en-US',
      region,
      serverId: String(serverId),
    });
    return parseSearch(await this.cached(`${SEARCH_URL}?${query}`, fresh), name, serverId);
  }

  private characterQuery(ref: { id: string; serverId: number }): string {
    return new URLSearchParams({
      lang: 'pt-br',
      characterId: ref.id,
      serverId: String(ref.serverId),
      region: this.lookup.region,
    }).toString();
  }

  async profile(ref: { id: string; serverId: number }, fresh = false): Promise<CharacterProfile> {
    const profile = parseProfile(
      await this.cached(`${API_URL}/info?${this.characterQuery(ref)}`, fresh),
    );
    if (!profile) throw new GameApiError('unexpected character info response');
    return profile;
  }

  /** One equipped piece in full; throws GameApiError when the site can't give it. */
  async item(
    ref: { id: string; serverId: number },
    piece: Pick<EquipmentItem, 'id' | 'slotPos' | 'enchantLevel'>,
  ): Promise<ItemDetail> {
    const query = new URLSearchParams({
      id: String(piece.id),
      enchantLevel: String(piece.enchantLevel),
      characterId: ref.id,
      serverId: String(ref.serverId),
      slotPos: String(piece.slotPos),
      lang: 'pt-br',
      region: this.lookup.region,
    });
    const detail = parseItemDetail(await this.cached(`${API_URL}/equipment/item?${query}`, false));
    if (!detail) throw new GameApiError('unexpected item detail response');
    return detail;
  }

  async sheet(ref: { id: string; serverId: number }): Promise<CharacterSheet> {
    const [profile, equipment] = await Promise.all([
      this.profile(ref),
      this.cached(`${API_URL}/equipment?${this.characterQuery(ref)}`, false).then(parseEquipment),
    ]);
    return { profile, equipment };
  }
}
