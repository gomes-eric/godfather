import { ptBR } from '../i18n/pt-BR.js';
import type { ApplyResult } from './applier.js';
import type { SetupOp, SetupPlan, SetupWarning } from './model.js';

const t = ptBR.setup;

const changeList = (changes: string[]) => changes.map((c) => t.changes[c] ?? c).join(', ');

export function describeOp(op: SetupOp): string {
  switch (op.type) {
    case 'adopt':
      return t.ops.adopt(t.kinds[op.kind] ?? op.kind, op.name);
    case 'createRole':
      return t.ops.createRole(op.role.name);
    case 'updateRole':
      return t.ops.updateRole(op.role.name, changeList(op.changes));
    case 'reorderRoles':
      return t.ops.reorderRoles;
    case 'createCategory':
      return t.ops.createCategory(op.category.name);
    case 'updateCategory':
      return t.ops.updateCategory(op.category.name, changeList(op.changes));
    case 'createChannel':
      return t.ops.createChannel(op.channel.name);
    case 'updateChannel':
      return t.ops.updateChannel(op.channel.name, changeList(op.changes));
    case 'enableCommunity':
      return t.ops.enableCommunity;
    case 'setCommunityChannels':
      return t.ops.setCommunityChannels;
    case 'reorderChannels':
      return t.ops.reorderChannels;
    case 'setAfk':
      return t.ops.setAfk(op.channelName, op.timeoutSeconds / 60);
    case 'upsertPanel':
      return t.ops.upsertPanel(op.panel.channelName);
    case 'deleteChannel':
      return t.ops.deleteChannel(op.name);
    case 'deleteCategory':
      return t.ops.deleteCategory(op.name);
    case 'deleteRole':
      return t.ops.deleteRole(op.name);
    case 'forgetMessage':
      return t.ops.forgetMessage(op.key);
  }
}

export function describeWarning(warning: SetupWarning): string {
  return warning.type === 'roleAboveBot'
    ? t.warnings.roleAboveBot(warning.name, changeList(warning.changes))
    : t.warnings.channelKindMismatch(warning.name, warning.expected, warning.actual);
}

/** Joins lines until `maxLength`, then summarizes the rest as "…e mais N itens". */
export function joinWithinLimit(lines: string[], maxLength: number): string {
  const kept: string[] = [];
  let length = 0;
  for (const [index, line] of lines.entries()) {
    const remaining = lines.length - index;
    const suffix = t.more(remaining);
    if (length + line.length + 1 > maxLength - suffix.length - 1) {
      kept.push(suffix);
      break;
    }
    kept.push(line);
    length += line.length + 1;
  }
  return kept.join('\n');
}

export function formatPlan(plan: SetupPlan, maxLength: number): string {
  const warnings = plan.warnings.map(describeWarning);
  if (plan.ops.length === 0) return [t.upToDate, ...warnings].join('\n\n');
  return joinWithinLimit([...warnings, ...plan.ops.map(describeOp)], maxLength);
}

export function formatResult(plan: SetupPlan, result: ApplyResult, maxLength: number): string {
  const lines = [t.applied(result.applied.length, result.failures.length)];
  for (const failure of result.failures) {
    lines.push(t.failure(describeOp(failure.op), failure.error));
    if (failure.op.type === 'enableCommunity') lines.push(t.communityManual);
  }
  lines.push(...plan.warnings.map(describeWarning));
  return joinWithinLimit(lines, maxLength);
}
