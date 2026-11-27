import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { registeredCharacters } from './schema.js';

export type RegisteredCharacter = typeof registeredCharacters.$inferSelect;

/** What the official site shows about a character right now. */
export interface CharacterSnapshot {
  name: string;
  classKey: string;
  legion: string;
  combatPower: number | null;
  itemLevel: number | null;
}

export class CharacterStore {
  constructor(private readonly db: Db) {}

  get(userId: string): RegisteredCharacter | undefined {
    return this.db
      .select()
      .from(registeredCharacters)
      .where(eq(registeredCharacters.userId, userId))
      .get();
  }

  /** Who has this in-game character registered, if anyone. */
  byCharacter(characterId: string): RegisteredCharacter | undefined {
    return this.db
      .select()
      .from(registeredCharacters)
      .where(eq(registeredCharacters.characterId, characterId))
      .get();
  }

  /** The member no longer has a character (it moved to another account). */
  delete(userId: string): void {
    this.db.delete(registeredCharacters).where(eq(registeredCharacters.userId, userId)).run();
  }

  all(): RegisteredCharacter[] {
    return this.db.select().from(registeredCharacters).all();
  }

  /** Registering again replaces the previous character. */
  save(
    entry: Pick<RegisteredCharacter, 'userId' | 'characterId' | 'serverId'> & CharacterSnapshot,
  ): void {
    const now = new Date();
    const row = { ...entry, checkedAt: now, updatedAt: now };
    this.db
      .insert(registeredCharacters)
      .values(row)
      .onConflictDoUpdate({ target: registeredCharacters.userId, set: row })
      .run();
  }

  /** Records what the daily check saw, keeping the registration itself. */
  updateSnapshot(userId: string, snapshot: CharacterSnapshot): void {
    this.db
      .update(registeredCharacters)
      .set({ ...snapshot, checkedAt: new Date() })
      .where(eq(registeredCharacters.userId, userId))
      .run();
  }
}
