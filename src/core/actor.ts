import type { Tier } from './tiers.js';

export type ActorSource = 'slash' | 'mcp' | 'system';

/**
 * Who is performing an action. The tier is resolved from the member's current roles on every
 * call, so a demotion takes effect immediately (PLAN.md §2).
 */
export interface Actor {
  userId: string;
  tier: Tier;
  source: ActorSource;
  /** MCP client name (e.g. "claude-code"), when the action came through MCP. */
  harness?: string;
}

export function systemActor(botUserId: string): Actor {
  return { userId: botUserId, tier: 'commander', source: 'system' };
}
