import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { registeredCharacters } from './schema.js';

export type RegisteredCharacter = typeof registeredCharacters.$inferSelect;

export class CharacterStore {
  constructor(private readonly db: Db) {}

  get(userId: string): RegisteredCharacter | undefined {
    return this.db
      .select()
      .from(registeredCharacters)
      .where(eq(registeredCharacters.userId, userId))
      .get();
  }

  /** Registering again replaces the previous character. */
  save(entry: Omit<RegisteredCharacter, 'updatedAt'>): void {
    const updatedAt = new Date();
    this.db
      .insert(registeredCharacters)
      .values({ ...entry, updatedAt })
      .onConflictDoUpdate({
        target: registeredCharacters.userId,
        set: {
          characterId: entry.characterId,
          name: entry.name,
          serverId: entry.serverId,
          classKey: entry.classKey,
          updatedAt,
        },
      })
      .run();
  }
}
