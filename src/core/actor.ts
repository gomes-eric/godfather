import type { Tier } from './tiers.js';

export type ActorSource = 'slash' | 'mcp' | 'system';

export interface Actor {
  userId: string;
  tier: Tier;
  source: ActorSource;
  harness?: string;
}

export function systemActor(botUserId: string): Actor {
  return { userId: botUserId, tier: 'commander', source: 'system' };
}
