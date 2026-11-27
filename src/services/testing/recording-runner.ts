import { createActionRunner } from '../../core/action.js';
import type { AuditEntry } from '../../core/audit.js';

export function recordingRunner() {
  const audit: AuditEntry[] = [];
  const runAction = createActionRunner({
    record: async (entry) => {
      audit.push(entry);
      return { ...entry, id: audit.length, at: new Date() };
    },
  });
  return { runAction, audit };
}
