import { refusedRequest, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { pickChannel } from '../discord/resolvers.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { GuildAdminPort, MessageView } from './guild-admin-port.js';

export interface SendOptions {
  title?: string;
  allowMentions?: boolean;
}

const PLAIN_MAX = 2000;

export class MessageService {
  constructor(private readonly deps: { guild: GuildAdminPort; runAction: ActionRunner }) {}

  async send(
    actor: Actor,
    channelId: string,
    text: string,
    options: SendOptions = {},
  ): Promise<ServiceOutcome<string>> {
    const channel = await this.deps.guild.fetchChannel(channelId);
    const name = channel?.name ?? channelId;

    return this.deps.runAction({
      actor,
      action: 'message.send',
      target: `#${name}`,
      params: { channelId, text, ...options },
      preview: text,
      check: () => (channel?.messageable ? null : ptBR.moderation.notText),
      execute: async () => {
        const allowMentions = options.allowMentions === true;
        // A plain message holds 2000 characters; longer text (from the /say form) goes as an embed.
        await this.deps.guild.send(
          channelId,
          options.title || text.length > PLAIN_MAX
            ? {
                allowMentions,
                embed: { description: text, ...(options.title && { title: options.title }) },
              }
            : { allowMentions, content: text },
        );
        return ptBR.say.sent(name);
      },
    });
  }

  /** The channel's last messages, oldest first. */
  async read(
    actor: Actor,
    channelInput: string,
    limit: number,
  ): Promise<ServiceOutcome<MessageView[]>> {
    const found = pickChannel(
      this.deps.guild.channels(),
      channelInput,
      (c) => c.kind !== 'category',
    );
    if (!found.ok) {
      return this.deps.runAction(
        refusedRequest({ actor, action: 'message.read', target: channelInput }, found.reason),
      );
    }
    const channel = found.value;

    return this.deps.runAction({
      actor,
      action: 'message.read',
      target: `#${channel.name}`,
      preview: channel.name,
      check: () => (channel.messageable ? null : ptBR.moderation.notText),
      execute: async () => (await this.deps.guild.recentMessages(channel.id, limit)).reverse(),
    });
  }
}
