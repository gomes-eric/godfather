import { Events, type Client } from 'discord.js';
import type { Logger } from '../../logger.js';
import type { MusicGuardService } from '../../services/music-guard.service.js';

export function attachMessageListener(
  client: Client,
  guildId: string,
  musicGuard: MusicGuardService,
  logger: Logger,
): void {
  client.on(Events.MessageCreate, (message) => {
    if (message.guildId !== guildId) return;
    musicGuard
      .onMessage(message)
      .catch((error: unknown) =>
        logger.warn({ err: error, message: message.id }, 'music guard failed'),
      );
  });
}
