import { auditCommand } from './audit.js';
import { bossCommand } from './boss.js';
import { configCommand } from './config.js';
import { eventCommand } from './event.js';
import { memberCommand } from './member.js';
import { modCommand } from './mod.js';
import { sayCommand } from './say.js';
import { setupCommand } from './setup.js';
import { voiceCommand } from './voice.js';
import type { SlashCommand } from './types.js';

// Every slash command the bot registers. Phase 7 adds mcp.
export const commands: SlashCommand[] = [
  setupCommand,
  configCommand,
  memberCommand,
  modCommand,
  sayCommand,
  voiceCommand,
  eventCommand,
  bossCommand,
  auditCommand,
];
