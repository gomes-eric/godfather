import { auditCommand } from './audit.js';
import { configCommand } from './config.js';
import { memberCommand } from './member.js';
import { modCommand } from './mod.js';
import { sayCommand } from './say.js';
import { setupCommand } from './setup.js';
import { voiceCommand } from './voice.js';
import type { SlashCommand } from './types.js';

// Every slash command the bot registers. Later phases add event, boss and mcp.
export const commands: SlashCommand[] = [
  setupCommand,
  configCommand,
  memberCommand,
  modCommand,
  sayCommand,
  voiceCommand,
  auditCommand,
];
