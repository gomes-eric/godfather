import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Actor } from '../core/actor.js';
import { registerCharacterTools } from './toolsets/characters.js';
import { registerConfigTools } from './toolsets/config.js';
import { registerEventTools } from './toolsets/events.js';
import { createToolKit, type McpServices } from './toolsets/kit.js';
import { registerMemberTools } from './toolsets/members.js';
import { registerMessageTools } from './toolsets/messages.js';
import { registerRoleTools } from './toolsets/roles.js';
import { registerServerTools } from './toolsets/server.js';
import { registerVoiceTools } from './toolsets/voice.js';

export type { McpServices };

/** Registers every Padrinho tool, bound to the calling actor (PLAN.md §8.3). */
export function registerTools(server: McpServer, s: McpServices, actor: Actor): void {
  const kit = createToolKit(server, s, actor);
  registerServerTools(kit);
  registerRoleTools(kit);
  registerMemberTools(kit);
  registerMessageTools(kit);
  registerEventTools(kit);
  registerCharacterTools(kit);
  registerVoiceTools(kit);
  registerConfigTools(kit);
}
