import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  db: Db;
  isHealthy(): boolean;
  close(): void;
}

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

/** Opens the SQLite database (":memory:" is allowed) and applies pending migrations. */
export function openDatabase(path: string): DatabaseHandle {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });

  return {
    db,
    isHealthy() {
      try {
        return sqlite.prepare('SELECT 1 AS ok').get() !== undefined;
      } catch {
        return false;
      }
    },
    close() {
      sqlite.close();
    },
  };
}
