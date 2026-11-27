import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { backupFileName, backupsToDelete } from './core/backups.js';

const KEEP = 14;
const databasePath = process.env.DATABASE_PATH ?? './data/padrinho.db';
const folder = join(dirname(databasePath), 'backups');

try {
  mkdirSync(folder, { recursive: true });
  const target = join(folder, backupFileName(new Date()));
  const db = new Database(databasePath, { readonly: true });
  try {
    await db.backup(target); // consistent copy even while the bot is writing
  } finally {
    db.close();
  }
  for (const old of backupsToDelete(readdirSync(folder), KEEP)) rmSync(join(folder, old));
  console.log(`backup written: ${target}`);
} catch (error) {
  console.error('backup failed:', error);
  process.exitCode = 1;
}
