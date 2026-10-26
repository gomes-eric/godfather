import { EmbedBuilder, type Guild, type MessageMentionOptions } from 'discord.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { COLORS } from '../discord/colors.js';
import { ptBR } from '../i18n/pt-BR.js';

export interface SendOptions {
  /** With a title the message goes out as an embed. */
  title?: string;
  color?: number;
  /** Lets @everyone, roles and users in the text ping; off by default. */
  allowMentions?: boolean;
}

const PLAIN_MAX = 2000;

/** Messages sent as the bot (PLAN.md §6.3). */
export class MessageService {
  constructor(private readonly deps: { guild: Guild; runAction: ActionRunner }) {}

  async send(
    actor: Actor,
    channelId: string,
    text: string,
    options: SendOptions = {},
  ): Promise<ServiceOutcome<string>> {
    const channel = await this.deps.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) return rejected(ptBR.moderation.notText);

    const allowedMentions: MessageMentionOptions = {
      parse: options.allowMentions ? ['everyone', 'roles', 'users'] : [],
    };

    return this.deps.runAction({
      actor,
      action: 'message.send',
      target: `#${channel.name}`,
      params: { channelId, text, ...options },
      preview: text,
      execute: async () => {
        // A plain message holds 2000 characters; longer text (from the /say form) goes as an embed.
        if (options.title || text.length > PLAIN_MAX) {
          const embed = new EmbedBuilder()
            .setDescription(text)
            .setColor(options.color ?? COLORS.brand);
          if (options.title) embed.setTitle(options.title);
          await channel.send({ embeds: [embed], allowedMentions });
        } else {
          await channel.send({ content: text, allowedMentions });
        }
        return ptBR.say.sent(channel.name);
      },
    });
  }
}
