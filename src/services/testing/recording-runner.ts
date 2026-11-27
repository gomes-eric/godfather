import { createActionRunner } from '../../core/action.js';
import type { AuditEntry } from '../../core/audit.js';

/** The real action runner, with an audit that keeps entries in memory. */
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
