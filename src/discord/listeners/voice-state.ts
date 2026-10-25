import { Events, type Client } from 'discord.js';
import type { Logger } from '../../logger.js';
import type { VoiceService } from '../../services/voice.service.js';

export function attachVoiceStateListener(
  client: Client,
  guildId: string,
  voice: VoiceService,
  logger: Logger,
): void {
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (newState.guild.id !== guildId) return;
    voice
      .onVoiceStateUpdate(oldState, newState)
      .catch((error: unknown) =>
        logger.error({ err: error, member: newState.id }, 'voice room handling failed'),
      );
  });
}
