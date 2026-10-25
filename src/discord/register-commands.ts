import { REST, Routes } from 'discord.js';
import type { Logger } from '../logger.js';
import type { SlashCommand } from './commands/types.js';

/**
 * Replaces the guild's slash commands with the given set. Guild-scoped commands update
 * instantly, unlike global ones (PLAN.md §7).
 */
export async function registerGuildCommands(options: {
  token: string;
  clientId: string;
  guildId: string;
  commands: SlashCommand[];
  logger: Logger;
}): Promise<void> {
  const { token, clientId, guildId, commands, logger } = options;
  const rest = new REST().setToken(token);

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands.map((command) => command.data),
  });
  logger.info({ commands: commands.map((c) => c.data.name) }, 'slash commands registered');
}
