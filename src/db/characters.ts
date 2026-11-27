import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { registeredCharacters } from './schema.js';

export type RegisteredCharacter = typeof registeredCharacters.$inferSelect;

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

  byCharacter(characterId: string): RegisteredCharacter | undefined {
    return this.db
      .select()
      .from(registeredCharacters)
      .where(eq(registeredCharacters.characterId, characterId))
      .get();
  }

  delete(userId: string): void {
    this.db.delete(registeredCharacters).where(eq(registeredCharacters.userId, userId)).run();
  }

  all(): RegisteredCharacter[] {
    return this.db.select().from(registeredCharacters).all();
  }

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

  updateSnapshot(userId: string, snapshot: CharacterSnapshot): void {
    this.db
      .update(registeredCharacters)
      .set({ ...snapshot, checkedAt: new Date() })
      .where(eq(registeredCharacters.userId, userId))
      .run();
  }
}
