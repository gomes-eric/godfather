import type { Actor } from './actor.js';
import type { AuditLog, AuditResult } from './audit.js';
import { ACTION_POLICIES, authorize, type ActionName } from './permissions.js';
import type { Tier } from './tiers.js';

export interface ActionRequest<T> {
  actor: Actor;
  action: ActionName;
  target?: string;
  params?: Record<string, unknown>;
  confirm?: boolean;
  preview: string;
  checkAfterAuthorization?: () => string | null;
  execute: () => Promise<T>;
}

export interface Rejected {
  status: 'rejected';
  reason: string;
}

export type ServiceOutcome<T> =
  | { status: 'ok'; value: T }
  | { status: 'confirmation_required'; preview: string }
  | { status: 'denied'; requiredTier: Tier }
  | Rejected;

export type ActionRunner = <T>(request: ActionRequest<T>) => Promise<ServiceOutcome<T>>;

export function rejected(reason: string): Rejected {
  return { status: 'rejected', reason };
}

export function refusedRequest(
  request: Pick<ActionRequest<never>, 'actor' | 'action' | 'target' | 'params'>,
  reason: string,
): ActionRequest<never> {
  return {
    ...request,
    preview: reason,
    checkAfterAuthorization: () => reason,
    execute: () => Promise.reject(new Error(reason)),
  };
}

function auditsResult(audited: boolean, actor: Actor, result: AuditResult): boolean {
  const deniedOverMcp = result === 'denied' && actor.source === 'mcp';
  return audited || deniedOverMcp;
}

export function createActionRunner(audit: Pick<AuditLog, 'record'>): ActionRunner {
  return async function runAction<T>(request: ActionRequest<T>): Promise<ServiceOutcome<T>> {
    const { actor, action, target, params } = request;
    const policy = ACTION_POLICIES[action];
    const record = async (result: AuditResult, extra?: Record<string, unknown>) => {
      if (auditsResult(policy.audited, actor, result)) {
        const details = params || extra ? { ...params, ...extra } : undefined;
        await audit.record({
          actor,
          action,
          result,
          ...(target !== undefined && { target }),
          ...(details !== undefined && { params: details }),
        });
      }
    };

    const authorization = authorize(actor.tier, action);
    if (!authorization.allowed) {
      await record('denied');
      return { status: 'denied', requiredTier: authorization.requiredTier };
    }

    const refusal = request.checkAfterAuthorization?.() ?? null;
    if (refusal !== null) {
      await record('rejected', { refusal });
      return rejected(refusal);
    }

    if (policy.destructive && request.confirm !== true) {
      await record('confirmation_required');
      return { status: 'confirmation_required', preview: request.preview };
    }

    let value: T;
    try {
      value = await request.execute();
    } catch (error) {
      await record('error');
      throw error;
    }
    await record('ok');
    return { status: 'ok', value };
  };
}
