import type { Actor } from './actor.js';
import type { AuditLog } from './audit.js';
import { ACTION_POLICIES, authorize, type ActionName } from './permissions.js';
import type { Tier } from './tiers.js';

export interface ActionRequest<T> {
  actor: Actor;
  action: ActionName;
  target?: string;
  params?: Record<string, unknown>;
  confirm?: boolean;
  preview: string;
  execute: () => Promise<T>;
}

export type ActionOutcome<T> =
  | { status: 'ok'; value: T }
  | { status: 'confirmation_required'; preview: string }
  | { status: 'denied'; requiredTier: Tier };

export type ActionRunner = <T>(request: ActionRequest<T>) => Promise<ActionOutcome<T>>;

export interface Rejected {
  status: 'rejected';
  reason: string;
}

export type ServiceOutcome<T> = ActionOutcome<T> | Rejected;

export function rejected(reason: string): Rejected {
  return { status: 'rejected', reason };
}

export function createActionRunner(audit: Pick<AuditLog, 'record'>): ActionRunner {
  return async function runAction<T>(request: ActionRequest<T>): Promise<ActionOutcome<T>> {
    const { actor, action, target, params } = request;
    const policy = ACTION_POLICIES[action];
    const record = async (result: 'ok' | 'denied' | 'error' | 'confirmation_required') => {
      if (policy.audited) {
        await audit.record({
          actor,
          action,
          result,
          ...(target !== undefined && { target }),
          ...(params !== undefined && { params }),
        });
      }
    };

    const authorization = authorize(actor.tier, action);
    if (!authorization.allowed) {
      await record('denied');
      return { status: 'denied', requiredTier: authorization.requiredTier };
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
