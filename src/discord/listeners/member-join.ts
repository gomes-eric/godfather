import { Events, type Client } from 'discord.js';
import type { Logger } from '../../logger.js';
import type { WelcomeService } from '../../services/welcome.service.js';

export function attachMemberJoinListener(
  client: Client,
  guildId: string,
  welcome: WelcomeService,
  logger: Logger,
): void {
  client.on(Events.GuildMemberAdd, (member) => {
    if (member.guild.id !== guildId) return;
    welcome
      .onMemberJoin(member)
      .catch((error: unknown) =>
        logger.error({ err: error, member: member.id }, 'failed to welcome member'),
      );
  });
}
