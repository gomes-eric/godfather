import type {
  ChatInputCommandInteraction,
  Guild,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { ActionRunner } from '../../core/action.js';
import type { Actor } from '../../core/actor.js';
import type { AuditLog } from '../../core/audit.js';
import type { Logger } from '../../logger.js';
import type { ConfirmationStore } from '../interactions/confirmation.js';

export interface CommandContext {
  guild: Guild;
  logger: Logger;
  audit: AuditLog;
  runAction: ActionRunner;
  confirmations: ConfirmationStore;
  resolveActor(userId: string): Promise<Actor>;
}

export interface SlashCommand {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void>;
}
