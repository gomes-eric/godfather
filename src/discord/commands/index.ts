import { auditCommand } from './audit.js';
import type { SlashCommand } from './types.js';

// Every slash command the bot registers. Later phases add setup, event, member, mod, ...
export const commands: SlashCommand[] = [auditCommand];
