const BACKUP_NAME = /^padrinho-\d{4}-\d{2}-\d{2}\.db$/;

export function backupFileName(now: Date): string {
  return `padrinho-${now.toISOString().slice(0, 10)}.db`;
}

export function backupsToDelete(files: string[], keep: number): string[] {
  return files
    .filter((file) => BACKUP_NAME.test(file))
    .sort()
    .reverse()
    .slice(keep);
}
