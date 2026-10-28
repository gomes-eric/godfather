import { auditCommand } from './audit.js';
import { configCommand } from './config.js';
import { mcpCommand } from './mcp.js';
import { eventCommand } from './event.js';
import { helpCommand } from './help.js';
import { memberCommand } from './member.js';
import { modCommand } from './mod.js';
import { partyCommand } from './party.js';
import { profileCommand } from './profile.js';
import { sayCommand } from './say.js';
import { setupCommand } from './setup.js';
import { voiceCommand } from './voice.js';
import type { SlashCommand } from './types.js';

// Every slash command the bot registers.
export const commands: SlashCommand[] = [
  helpCommand,
  setupCommand,
  configCommand,
  memberCommand,
  modCommand,
  sayCommand,
  voiceCommand,
  eventCommand,
  profileCommand,
  partyCommand,
  mcpCommand,
  auditCommand,
];
