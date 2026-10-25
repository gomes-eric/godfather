import { auditCommand } from './audit.js';
import { configCommand } from './config.js';
import { setupCommand } from './setup.js';
import type { SlashCommand } from './types.js';

// Every slash command the bot registers. Later phases add event, member, mod, say, voice, ...
export const commands: SlashCommand[] = [setupCommand, configCommand, auditCommand];
