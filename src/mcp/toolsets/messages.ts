import { z } from 'zod';
import { channel, confirm, type ToolKit } from './kit.js';

export function registerMessageTools({ tool, memberId, channelId, s, actor }: ToolKit): void {
  tool(
    'purge_messages',
    'Apaga as últimas N mensagens de um canal (destrutivo).',
    {
      channel,
      count: z.number().int().min(1).max(100),
      member: z.string().optional().describe('Só mensagens desta pessoa'),
      confirm,
    },
    async (args) => {
      const id = channelId(args.channel);
      const authorId = args.member ? memberId(args.member) : null;
      return s.moderation.purge(actor, id, args.count, authorId, args.confirm === true);
    },
  );

  tool(
    'send_message',
    'Envia uma mensagem como o Padrinho. Menções só notificam com allowMentions: true.',
    {
      channel,
      text: z.string().min(1).max(2000),
      title: z.string().max(256).optional().describe('Com título, vai como embed'),
      allowMentions: z.boolean().optional(),
    },
    async (args) => {
      return s.messages.send(actor, channelId(args.channel), args.text, {
        ...(args.title && { title: args.title }),
        ...(args.allowMentions !== undefined && { allowMentions: args.allowMentions }),
      });
    },
  );
}
