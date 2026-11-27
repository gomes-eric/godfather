import { ChannelType } from 'discord.js';
import { z } from 'zod';
import { memberStanding, memberTier } from '../../discord/members.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { json, member, channel, confirm, type ToolKit } from './kit.js';

export function registerServerTools({ tool, read, memberId, channelId, s, actor }: ToolKit): void {
  tool(
    'get_server_overview',
    'Resumo do servidor: membros por cargo, categorias e canais, próximos eventos.',
    {},
    async () => {
      const byTier: Record<string, number> = {};
      const standingRoles = s.directory.standingRoles();
      for (const m of s.guild.members.cache.values()) {
        if (m.user.bot) continue;
        const tier = ptBR.tier(memberTier(m, s.directory, standingRoles));
        byTier[tier] = (byTier[tier] ?? 0) + 1;
      }
      const categories = [...s.guild.channels.cache.values()]
        .filter((c) => c.type === ChannelType.GuildCategory)
        .sort((a, b) =>
          'rawPosition' in a && 'rawPosition' in b ? a.rawPosition - b.rawPosition : 0,
        )
        .map((category) => ({
          category: category.name,
          channels: [...s.guild.channels.cache.values()]
            .filter((c) => c.parentId === category.id)
            // Discord lists text channels before voice ones, each by position.
            .sort(
              (a, b) =>
                Number(a.type === ChannelType.GuildVoice) -
                  Number(b.type === ChannelType.GuildVoice) ||
                ('rawPosition' in a && 'rawPosition' in b ? a.rawPosition - b.rawPosition : 0),
            )
            .map((c) => (c.type === ChannelType.GuildVoice ? `🔊 ${c.name}` : `#${c.name}`)),
        }));
      const upcoming = await s.events.list(actor);
      return json({
        server: s.guild.name,
        members: byTier,
        categories,
        upcomingEvents: upcoming.status === 'ok' ? upcoming.value.length : 'sem permissão',
      });
    },
  );

  tool('list_channels', 'Lista os canais com tipo, categoria e ID.', {}, async () =>
    json(
      [...s.guild.channels.cache.values()].map((c) => ({
        id: c.id,
        name: c.name,
        type: ChannelType[c.type],
        category: c.parentId ? s.guild.channels.cache.get(c.parentId)?.name : null,
      })),
    ),
  );

  tool('list_roles', 'Lista os cargos com quantidade de membros.', {}, async () =>
    json(
      [...s.guild.roles.cache.values()]
        .filter((r) => r.id !== s.guild.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, members: r.members.size, bot: r.managed })),
    ),
  );

  tool(
    'list_members',
    'Lista membros (até 100) com cargo na legião e classes. Filtra por nome se query for passada.',
    { query: z.string().optional() },
    async ({ query }) => {
      const needle = query?.toLowerCase();
      const standingRoles = s.directory.standingRoles();
      const rows = [...s.guild.members.cache.values()]
        .filter((m) => !m.user.bot)
        .filter(
          (m) =>
            !needle ||
            m.displayName.toLowerCase().includes(needle) ||
            m.user.username.toLowerCase().includes(needle),
        )
        .slice(0, 100)
        .map((m) => ({
          id: m.id,
          name: m.displayName,
          username: m.user.username,
          tier: ptBR.tier(memberTier(m, s.directory, standingRoles)),
          standing: s.members.standingName(memberStanding(m, s.directory, standingRoles)),
          classes: s.directory.classesOf(m).map((r) => r.name),
        }));
      return json(rows);
    },
  );

  tool('get_member', 'Detalhes de um membro: cargo, classes, datas.', { member }, async (args) =>
    s.members.info(actor, memberId(args.member)),
  );

  tool(
    'read_messages',
    'Lê as últimas mensagens de um canal (máx. 50) para dar contexto.',
    { channel, limit: z.number().int().min(1).max(50).default(20) },
    async (args) => {
      const id = channelId(args.channel);
      return read('message.read', async () => {
        const target = s.guild.channels.cache.get(id);
        if (!target?.isTextBased()) throw new Error('não é um canal de texto');
        const messages = await target.messages.fetch({ limit: args.limit });
        return {
          ...(s.messageContent
            ? {}
            : {
                note: 'O bot está sem o Message Content Intent: o texto de mensagens comuns vem vazio. Ative no Developer Portal e defina DISCORD_MESSAGE_CONTENT=true.',
              }),
          messages: [...messages.values()].reverse().map((m) => ({
            at: m.createdAt.toISOString(),
            author: m.member?.displayName ?? m.author.username,
            content: m.content,
          })),
        };
      });
    },
  );

  tool(
    'get_audit_log',
    'Últimas ações registradas na auditoria.',
    { limit: z.number().int().min(1).max(50).default(15) },
    async ({ limit }) => read('audit.read', async () => s.audit.recent(limit)),
  );

  tool(
    'create_channel',
    'Cria um canal avulso de texto ou voz (fora do server.yaml).',
    {
      name: z.string().min(1).max(100),
      type: z.enum(['text', 'voice']),
      category: z.string().optional().describe('Nome da categoria'),
      topic: z.string().max(1024).optional(),
      userLimit: z.number().int().min(0).max(99).optional(),
    },
    async (args) => s.channels.create(actor, args),
  );

  tool(
    'edit_channel',
    'Renomeia um canal ou muda tópico/limite.',
    {
      channel,
      name: z.string().min(1).max(100).optional(),
      topic: z.string().max(1024).optional(),
      userLimit: z.number().int().min(0).max(99).optional(),
    },
    async ({ channel: target, ...edit }) => s.channels.edit(actor, target, edit),
  );

  tool('delete_channel', 'Apaga um canal (destrutivo).', { channel, confirm }, async (args) =>
    s.channels.delete(actor, args.channel, args.confirm === true),
  );
}
