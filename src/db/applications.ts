import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { Db } from './client.js';
import { applications } from './schema.js';

type Row = typeof applications.$inferSelect;
type CharacterColumn =
  | 'characterId'
  | 'characterName'
  | 'serverId'
  | 'className'
  | 'level'
  | 'legion'
  | 'combatPower'
  | 'itemLevel';

/** The character as the official site showed it when the application was sent. */
export interface ApplicationCharacter {
  id: string;
  name: string;
  serverId: number;
  className: string;
  level: number;
  legion: string;
  combatPower: number | null;
  itemLevel: number | null;
}

/** A Parceiro may send the form without a character: then `character` is null. */
export type Application = Omit<Row, CharacterColumn> & { character: ApplicationCharacter | null };
export type ApplicationKind = Application['kind'];
export type NewApplication = Omit<
  typeof applications.$inferInsert,
  CharacterColumn | 'id' | 'status' | 'messageId' | 'decidedBy' | 'decidedAt' | 'createdAt'
> & { character: ApplicationCharacter | null };

function fromRow(row: Row): Application {
  const {
    characterId,
    characterName,
    serverId,
    className,
    level,
    legion,
    combatPower,
    itemLevel,
    ...rest
  } = row;
  const complete =
    characterId !== null &&
    characterName !== null &&
    serverId !== null &&
    className !== null &&
    level !== null;
  return {
    ...rest,
    character: complete
      ? {
          id: characterId,
          name: characterName,
          serverId,
          className,
          level,
          legion,
          combatPower,
          itemLevel,
        }
      : null,
  };
}

function toColumns(character: ApplicationCharacter | null) {
  return {
    characterId: character?.id ?? null,
    characterName: character?.name ?? null,
    serverId: character?.serverId ?? null,
    className: character?.className ?? null,
    level: character?.level ?? null,
    legion: character?.legion ?? '',
    combatPower: character?.combatPower ?? null,
    itemLevel: character?.itemLevel ?? null,
  };
}

export class ApplicationStore {
  constructor(private readonly db: Db) {}

  create({ character, ...application }: NewApplication): Application {
    const row = this.db
      .insert(applications)
      .values({ ...application, ...toColumns(character) })
      .returning()
      .get();
    return fromRow(row);
  }

  get(id: number): Application | undefined {
    const row = this.db.select().from(applications).where(eq(applications.id, id)).get();
    return row && fromRow(row);
  }

  pendingFor(userId: string): Application | undefined {
    const row = this.db
      .select()
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.status, 'pending')))
      .orderBy(desc(applications.createdAt))
      .get();
    return row && fromRow(row);
  }

  list(status?: Application['status'], limit = 50): Application[] {
    return this.db
      .select()
      .from(applications)
      .where(status ? eq(applications.status, status) : undefined)
      .orderBy(desc(applications.createdAt))
      .limit(limit)
      .all()
      .map(fromRow);
  }

  setMessage(id: number, messageId: string, threadId: string | null): void {
    this.db.update(applications).set({ messageId, threadId }).where(eq(applications.id, id)).run();
  }

  decidedWithThread(): Application[] {
    return this.db
      .select()
      .from(applications)
      .where(and(isNotNull(applications.threadId), isNotNull(applications.decidedAt)))
      .all()
      .map(fromRow);
  }

  forgetThread(id: number): void {
    this.db
      .update(applications)
      .set({ threadId: null, messageId: null })
      .where(eq(applications.id, id))
      .run();
  }

  setKind(id: number, kind: ApplicationKind, allianceLegion: string | null): void {
    this.db.update(applications).set({ kind, allianceLegion }).where(eq(applications.id, id)).run();
  }

  decide(id: number, status: 'approved' | 'rejected', decidedBy: string): void {
    this.db
      .update(applications)
      .set({ status, decidedBy, decidedAt: new Date() })
      .where(eq(applications.id, id))
      .run();
  }
}
