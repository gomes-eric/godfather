import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { tempVoiceChannels } from './schema.js';

export type TempRoom = typeof tempVoiceChannels.$inferSelect;

export class TempVoiceStore {
  constructor(private readonly db: Db) {}

  all(): TempRoom[] {
    return this.db.select().from(tempVoiceChannels).all();
  }

  get(channelId: string): TempRoom | undefined {
    return this.db
      .select()
      .from(tempVoiceChannels)
      .where(eq(tempVoiceChannels.channelId, channelId))
      .get();
  }

  numbersFor(generatorKey: string): number[] {
    return this.db
      .select({ number: tempVoiceChannels.number })
      .from(tempVoiceChannels)
      .where(eq(tempVoiceChannels.generatorKey, generatorKey))
      .all()
      .map((row) => row.number);
  }

  insert(room: { channelId: string; generatorKey: string; number: number; ownerId: string }): void {
    this.db.insert(tempVoiceChannels).values(room).run();
  }

  setOwner(channelId: string, ownerId: string): void {
    this.db
      .update(tempVoiceChannels)
      .set({ ownerId })
      .where(eq(tempVoiceChannels.channelId, channelId))
      .run();
  }

  delete(channelId: string): void {
    this.db.delete(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId)).run();
  }
}
