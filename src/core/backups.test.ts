import { describe, expect, it } from 'vitest';
import { backupFileName, backupsToDelete } from './backups.js';

describe('backups', () => {
  it('names backups by UTC date', () => {
    expect(backupFileName(new Date('2026-10-25T08:00:00Z'))).toBe('padrinho-2026-10-25.db');
  });

  it('keeps the newest N and ignores unrelated files', () => {
    const files = [
      'padrinho-2026-10-20.db',
      'notes.txt',
      'padrinho-2026-10-25.db',
      'padrinho-2026-10-22.db',
      'padrinho-2026-10-21.db',
    ];
    expect(backupsToDelete(files, 2)).toEqual(['padrinho-2026-10-21.db', 'padrinho-2026-10-20.db']);
    expect(backupsToDelete(files, 14)).toEqual([]);
  });
});
