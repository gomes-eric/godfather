import { ChannelType, type Guild } from 'discord.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ConfigError } from '../config/loader.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import type { AuditLog } from '../core/audit.js';
import { TIERS } from '../core/tiers.js';
import { memberTier } from '../discord/members.js';
import type { GuildDirectory } from '../discord/directory.js';
import { findChannel, findMember } from '../discord/resolvers.js';
import { ptBR } from '../i18n/pt-BR.js';
import { classRoles } from '../config/schema.js';
import { itemLabel, sameLegion } from '../core/game-character.js';
import type { ApplicationStore } from '../db/applications.js';
import type { CharacterStore } from '../db/characters.js';
import type { ChannelService } from '../services/channel.service.js';
import {
  GameApiError,
  type CharacterSheet,
  type GameCharacterService,
} from '../services/game-character.service.js';
import type { LegionCheckService } from '../services/legion-check.service.js';
import type { RecruitmentDesk } from '../services/recruitment-desk.service.js';
import type { RegistrationService } from '../services/registration.service.js';
import { parseDays, type EventService } from '../services/event.service.js';
import type { FieldBossService } from '../services/field-boss.service.js';
import type { MemberService } from '../services/member.service.js';
import type { MessageService } from '../services/message.service.js';
import type { ModerationService } from '../services/moderation.service.js';
import type { RoleService } from '../services/role.service.js';
import type { SetupService } from '../services/setup.service.js';
import { formatPlan, formatResult } from '../setup/format.js';

export interface McpServices {
  guild: Guild;
  config: ConfigStore;
  directory: GuildDirectory;
  audit: AuditLog;
  runAction: ActionRunner;
  setup: SetupService;
  members: MemberService;
  moderation: ModerationService;
  messages: MessageService;
  events: EventService;
  bosses: FieldBossService;
  channels: ChannelService;
  roles: RoleService;
  /** Characters on the official Aion 2 site. */
  characters: GameCharacterService;
  /** Which character each member has. */
  registrations: CharacterStore;
  registration: RegistrationService;
  applications: ApplicationStore;
  recruitmentDesk: RecruitmentDesk;
  legion: LegionCheckService;
  /** Whether the bot has the Message Content intent (needed by read_messages). */
  messageContent: boolean;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });
const fail = (value: string): ToolResult => ({ ...text(value), isError: true });
const json = (value: unknown): ToolResult => text(JSON.stringify(value, null, 2));

/** Turns a service outcome into a tool result; a pending confirmation becomes a preview. */
function fromOutcome<T>(
  outcome: ServiceOutcome<T>,
  render: (value: T) => ToolResult = (value) =>
    typeof value === 'string' ? text(value) : json(value),
): ToolResult {
  switch (outcome.status) {
    case 'ok':
      return render(outcome.value);
    case 'confirmation_required':
      return json({
        status: 'confirmation_required',
        preview: outcome.preview,
        hint: 'Show the preview to the user, ask for explicit confirmation, then call again with confirm: true.',
      });
    case 'denied':
      return fail(ptBR.errors.denied(outcome.requiredTier));
    case 'rejected':
      return fail(outcome.reason);
  }
}

const member = z.string().describe('Membro: nome, @menção ou ID');
const channel = z.string().describe('Canal: nome (com ou sem #), menção ou ID');
const confirm = z
  .boolean()
  .optional()
  .describe('Só true depois que o usuário confirmou a prévia mostrada');
const reason = z.string().max(400).optional().describe('Motivo (vai para a auditoria)');

/** Registers every Padrinho tool, bound to the calling actor (PLAN.md §8.3). */
export function registerTools(server: McpServer, s: McpServices, actor: Actor): void {
  const tool = <Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: Shape,
    handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>,
  ) =>
    server.registerTool(name, { description, inputSchema }, (async (args: unknown) => {
      try {
        return await handler(args as z.infer<z.ZodObject<Shape>>);
      } catch (error) {
        return fail(
          `Erro ao executar ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }) as never);

  const memberId = (input: string): string | ToolResult => {
    const found = findMember(s.guild, input);
    return found.ok ? found.value.id : fail(found.reason);
  };
  /** Runs `run` with the member's id, or explains who couldn't be found. */
  const withMember = async (
    input: string,
    run: (id: string) => Promise<ServiceOutcome<unknown>>,
  ): Promise<ToolResult> => {
    const id = memberId(input);
    return typeof id === 'string' ? fromOutcome(await run(id)) : id;
  };
  const channelId = (input: string, voiceOnly = false): string | ToolResult => {
    const found = findChannel(s.guild, input, (c) =>
      voiceOnly
        ? c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice
        : c.type !== ChannelType.GuildCategory,
    );
    return found.ok ? found.value.id : fail(found.reason);
  };

  // ---- Reading -------------------------------------------------------------------------------

  tool(
    'get_server_overview',
    'Resumo do servidor: membros por cargo, categorias e canais, próximos eventos.',
    {},
    async () => {
      const byTier: Record<string, number> = {};
      for (const m of s.guild.members.cache.values()) {
        if (m.user.bot) continue;
        const tier = ptBR.tier(memberTier(m, s.directory));
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
          tier: ptBR.tier(memberTier(m, s.directory)),
          classes: s.directory.classesOf(m).map((r) => r.name),
        }));
      return json(rows);
    },
  );

  tool('get_member', 'Detalhes de um membro: cargo, classes, datas.', { member }, async (args) =>
    withMember(args.member, (id) => s.members.info(actor, id)),
  );

  tool(
    'read_messages',
    'Lê as últimas mensagens de um canal (máx. 50) para dar contexto.',
    { channel, limit: z.number().int().min(1).max(50).default(20) },
    async (args) => {
      const id = channelId(args.channel);
      if (typeof id !== 'string') return id;
      return fromOutcome(
        await s.runAction({
          actor,
          action: 'message.read',
          preview: 'message.read',
          execute: async () => {
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
          },
        }),
      );
    },
  );

  tool(
    'get_audit_log',
    'Últimas ações registradas na auditoria.',
    { limit: z.number().int().min(1).max(50).default(15) },
    async ({ limit }) =>
      fromOutcome(
        await s.runAction({
          actor,
          action: 'audit.read',
          preview: 'audit.read',
          execute: async () => s.audit.recent(limit),
        }),
      ),
  );

  // ---- Channels and roles --------------------------------------------------------------------

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
    async (args) => fromOutcome(await s.channels.create(actor, args)),
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
    async ({ channel: target, ...edit }) => fromOutcome(await s.channels.edit(actor, target, edit)),
  );

  tool('delete_channel', 'Apaga um canal (destrutivo).', { channel, confirm }, async (args) =>
    fromOutcome(await s.channels.delete(actor, args.channel, args.confirm === true)),
  );

  const roleFields = {
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional()
      .describe('#RRGGBB'),
    hoist: z.boolean().optional().describe('Exibir separadamente na lista de membros'),
    mentionable: z.boolean().optional(),
  };
  tool(
    'create_role',
    'Cria um cargo avulso sem permissões especiais.',
    { name: z.string().min(1).max(100), ...roleFields },
    async (args) => fromOutcome(await s.roles.create(actor, args)),
  );
  tool(
    'edit_role',
    'Edita nome/cor/exibição de um cargo.',
    { role: z.string(), name: z.string().min(1).max(100).optional(), ...roleFields },
    async ({ role, ...edit }) => fromOutcome(await s.roles.edit(actor, role, edit)),
  );
  tool('delete_role', 'Apaga um cargo (destrutivo).', { role: z.string(), confirm }, async (args) =>
    fromOutcome(await s.roles.delete(actor, args.role, args.confirm === true)),
  );
  tool(
    'assign_role',
    'Dá um cargo (não da hierarquia) a um membro.',
    { member, role: z.string() },
    async (args) => fromOutcome(await s.roles.setAssignment(actor, args.member, args.role, true)),
  );
  tool(
    'remove_role',
    'Remove um cargo (não da hierarquia) de um membro.',
    { member, role: z.string() },
    async (args) => fromOutcome(await s.roles.setAssignment(actor, args.member, args.role, false)),
  );

  // ---- Members and moderation ----------------------------------------------------------------

  const rank = z.enum(TIERS).optional().describe('visitor | soldier | officer');
  tool(
    'promote_member',
    'Promove um membro (Visitante → Soldado → Oficial).',
    { member, rank },
    async (args) => withMember(args.member, (id) => s.members.promote(actor, id, args.rank)),
  );
  tool(
    'demote_member',
    'Rebaixa um membro um nível (destrutivo).',
    { member, rank, confirm },
    async (args) =>
      withMember(args.member, (id) =>
        s.members.demote(actor, id, args.rank, args.confirm === true),
      ),
  );
  tool(
    'partner_member',
    'Torna Parceiro (amigo que não joga) um Visitante, ou com remove=true tira o Parceiro e volta para Visitante.',
    { member, remove: z.boolean().optional().describe('true para tirar o cargo') },
    async (args) =>
      withMember(args.member, (id) => s.members.partner(actor, id, args.remove === true)),
  );
  tool(
    'kick_member',
    'Expulsa um membro (destrutivo).',
    { member, reason, confirm },
    async (args) =>
      withMember(args.member, (id) =>
        s.moderation.kick(actor, id, args.reason ?? null, args.confirm === true),
      ),
  );
  tool(
    'ban_member',
    'Bane alguém (destrutivo). Não apaga mensagens, a menos que deleteMessagesHours seja passado.',
    {
      member: z.string().describe('Membro (nome, menção) ou ID de quem já saiu'),
      reason,
      deleteMessagesHours: z.number().int().min(0).max(168).optional(),
      confirm,
    },
    async (args) => {
      const found = findMember(s.guild, args.member);
      const id = found.ok ? found.value.id : /^\d{17,20}$/.test(args.member) ? args.member : null;
      if (!id) return fail(found.ok ? '' : found.reason);
      return fromOutcome(
        await s.moderation.ban(
          actor,
          id,
          args.reason ?? null,
          args.deleteMessagesHours ?? 0,
          args.confirm === true,
        ),
      );
    },
  );
  tool(
    'unban_member',
    'Desbane alguém pelo ID.',
    { userId: z.string().regex(/^\d{17,20}$/), reason },
    async (args) => fromOutcome(await s.moderation.unban(actor, args.userId, args.reason ?? null)),
  );
  tool(
    'timeout_member',
    'Silencia um membro por N minutos (0 remove o timeout).',
    { member, minutes: z.number().int().min(0).max(40320), reason },
    async (args) =>
      withMember(args.member, (id) =>
        s.moderation.timeout(actor, id, args.minutes, args.reason ?? null),
      ),
  );
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
      if (typeof id !== 'string') return id;
      let authorId: string | null = null;
      if (args.member) {
        const found = memberId(args.member);
        if (typeof found !== 'string') return found;
        authorId = found;
      }
      return fromOutcome(
        await s.moderation.purge(actor, id, args.count, authorId, args.confirm === true),
      );
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
      const id = channelId(args.channel);
      if (typeof id !== 'string') return id;
      return fromOutcome(
        await s.messages.send(actor, id, args.text, {
          ...(args.title && { title: args.title }),
          ...(args.allowMentions !== undefined && { allowMentions: args.allowMentions }),
        }),
      );
    },
  );

  // ---- Events --------------------------------------------------------------------------------

  tool('list_events', 'Eventos dos próximos 7 dias, com o número (id) de cada um.', {}, async () =>
    fromOutcome(await s.events.list(actor), (views) =>
      json(
        views.map((v) => ({
          id: v.occurrenceId,
          title: v.title,
          startsAt: v.startsAt.toISOString(),
          recurring: v.templateKey !== null,
        })),
      ),
    ),
  );
  tool(
    'create_event',
    'Cria um evento pontual com avisos automáticos (30 min antes e no início).',
    {
      title: z.string().min(1).max(100),
      when: z.string().describe('Como o usuário falou: "amanhã 20h", "sáb 21:00", "30/10 21:00"'),
      description: z.string().max(1000).optional(),
      voiceChannel: z.string().optional().describe('Sala de voz do evento'),
      emoji: z.string().max(32).optional(),
      ping: z.boolean().optional().describe('Marcar @everyone (padrão: sim)'),
    },
    async (args) => {
      let voiceChannelId: string | undefined;
      if (args.voiceChannel) {
        const id = channelId(args.voiceChannel, true);
        if (typeof id !== 'string') return id;
        voiceChannelId = id;
      }
      return fromOutcome(
        await s.events.create(actor, {
          title: args.title,
          when: args.when,
          ...(args.description && { description: args.description }),
          ...(args.emoji && { emoji: args.emoji }),
          ...(voiceChannelId && { voiceChannelId }),
          ...(args.ping !== undefined && { ping: args.ping }),
        }),
      );
    },
  );
  tool(
    'update_event',
    'Edita um evento pontual (título, data, descrição).',
    {
      id: z.number().int(),
      title: z.string().min(1).max(100).optional(),
      when: z.string().optional(),
      description: z.string().max(1000).optional(),
    },
    async ({ id, ...edit }) => fromOutcome(await s.events.edit(actor, id, edit)),
  );
  tool(
    'cancel_event',
    'Cancela um evento, ou só uma data de um recorrente (destrutivo).',
    { id: z.number().int(), confirm },
    async (args) => fromOutcome(await s.events.cancel(actor, args.id, args.confirm === true)),
  );
  tool('get_rsvps', 'Quem confirmou presença num evento.', { id: z.number().int() }, async (args) =>
    fromOutcome(await s.events.rsvps(actor, args.id), ({ view, rsvp }) =>
      json({ event: view.title, ...rsvp }),
    ),
  );
  tool('list_event_templates', 'Eventos recorrentes do server.yaml.', {}, async () =>
    json(s.config.get().eventTemplates),
  );
  tool(
    'update_event_template',
    'Muda horário, dias, título ou liga/desliga um evento recorrente (grava no server.yaml).',
    {
      key: z.string(),
      time: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional()
        .describe('HH:MM, horário de Brasília'),
      days: z.string().optional().describe('"seg qui sáb", "mon,thu,sat" ou "todo dia"'),
      title: z.string().min(1).max(100).optional(),
      enabled: z.boolean().optional(),
    },
    async ({ key, days, ...rest }) => {
      const parsedDays = days ? parseDays(days) : undefined;
      if (days && !parsedDays) return fail(`Dias inválidos: "${days}"`);
      return fromOutcome(
        await s.events.updateTemplate(actor, key, {
          ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
          ...(parsedDays && { days: parsedDays }),
        }),
      );
    },
  );

  // ---- Field bosses --------------------------------------------------------------------------

  tool(
    'list_field_bosses',
    'Próximos respawns dos bosses de campo e a origem do horário.',
    {},
    async () =>
      fromOutcome(
        await s.runAction({
          actor,
          action: 'boss.read',
          preview: 'boss.read',
          execute: async () =>
            s.bosses.status().map(({ boss, timer }) => ({
              key: boss.key,
              title: boss.title,
              alive: timer?.alive ?? null,
              respawnAt: timer?.respawnAt?.toISOString() ?? null,
              source: timer?.source ?? null,
              seenAt: timer?.seenAt.toISOString() ?? null,
            })),
        }),
      ),
  );
  tool(
    'set_boss_respawn',
    'Define o respawn de um boss à mão: relógio do mapa ("09:16") ou tempo restante ("5h44m").',
    { boss: z.string(), time: z.string() },
    async (args) => fromOutcome(await s.bosses.set(actor, args.boss, args.time)),
  );
  tool(
    'report_boss_kill',
    'Registra que o boss acabou de morrer (precisa de respawnMinutes).',
    { boss: z.string() },
    async (args) => fromOutcome(await s.bosses.killed(actor, args.boss)),
  );
  tool(
    'clear_boss_override',
    'Remove o horário manual de um boss.',
    { boss: z.string() },
    async (args) => fromOutcome(await s.bosses.clear(actor, args.boss)),
  );

  // ---- Characters, registration, recruitment and the legion -----------------------------------

  const sheetJson = ({ profile, equipment }: CharacterSheet) => ({
    ...profile,
    equipment: equipment.map((item) => ({ slot: item.slot, item: itemLabel(item) })),
  });
  tool(
    'get_character',
    'Personagem do Aion 2 no site oficial: classe, nível, poder de combate, nível de item, legião e equipamentos. Passe o nome do personagem ou um membro do Discord com personagem registrado.',
    {
      name: z.string().optional().describe('Nome exato do personagem no jogo'),
      member: z.string().optional().describe('Membro do Discord com personagem registrado'),
    },
    async (args) =>
      fromOutcome(
        await s
          .runAction({
            actor,
            action: 'character.read',
            preview: 'character.read',
            execute: async (): Promise<string | ReturnType<typeof sheetJson>> => {
              if (args.name) {
                const ref = await s.characters.find(args.name);
                return ref
                  ? sheetJson(await s.characters.sheet(ref))
                  : ptBR.profile.notFound(args.name);
              }
              if (!args.member) return 'Passe name ou member.';
              const found = findMember(s.guild, args.member);
              if (!found.ok) return found.reason;
              const registered = s.registrations.get(found.value.id);
              if (!registered) return ptBR.profile.memberNotRegistered(found.value.id);
              return sheetJson(
                await s.characters.sheet({
                  id: registered.characterId,
                  serverId: registered.serverId,
                }),
              );
            },
          })
          .catch(gameFailure),
      ),
  );
  tool(
    'list_registered_characters',
    'Membros do Discord com personagem registrado, com classe, poder, legião vista na última conferência e se ainda estão no servidor.',
    {},
    async () =>
      fromOutcome(
        await s.runAction({
          actor,
          action: 'character.read',
          preview: 'character.read',
          execute: async () => {
            const { legion } = s.config.get().settings.characters;
            const classes = new Map(classRoles(s.config.get()).map((r) => [r.key, r.name]));
            return s.registrations
              .all()
              .sort((a, b) => (b.combatPower ?? -1) - (a.combatPower ?? -1))
              .map((row) => {
                const member = s.guild.members.cache.get(row.userId);
                return {
                  character: row.name,
                  class: classes.get(row.classKey) ?? row.classKey,
                  combatPower: row.combatPower,
                  itemLevel: row.itemLevel,
                  legion: row.legion || null,
                  inLegion: sameLegion(row.legion, legion),
                  member: member?.displayName ?? null,
                  userId: row.userId,
                  checkedAt: row.checkedAt?.toISOString() ?? null,
                };
              });
          },
        }),
      ),
  );
  tool(
    'register_character',
    'Registra o personagem de um membro, como uma ficha aprovada: cargo da classe, apelido "emoji Nome", personagem guardado para /perfil e #ranking, e Soldado se ele for Visitante.',
    { member, character: z.string().describe('Nome exato do personagem no jogo') },
    async (args) =>
      withMember(args.member, (id) => s.registration.register(actor, id, args.character)),
  );
  tool(
    'list_applications',
    'Fichas de recrutamento (as mais novas primeiro), com o id usado em decide_application.',
    { status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending') },
    async ({ status }) =>
      fromOutcome(
        await s.runAction({
          actor,
          action: 'recruit.read',
          preview: 'recruit.read',
          execute: async () =>
            s.applications.list(status === 'all' ? undefined : status).map((a) => ({
              id: a.id,
              status: a.status,
              character: a.characterName,
              class: a.className,
              level: a.level,
              combatPower: a.combatPower,
              itemLevel: a.itemLevel,
              legion: a.legion || null,
              member: s.guild.members.cache.get(a.userId)?.displayName ?? a.userId,
              schedule: a.schedule,
              reason: a.reason,
              createdAt: a.createdAt.toISOString(),
              decidedBy: a.decidedBy,
            })),
        }),
      ),
  );
  tool(
    'decide_application',
    'Aprova ou recusa uma ficha de recrutamento. Aprovar registra o personagem, dá Soldado e dá as boas-vindas no canal; o card no #recrutamento é atualizado.',
    { id: z.number().int(), approve: z.boolean() },
    async (args) =>
      fromOutcome(await s.recruitmentDesk.decide(actor, args.id, args.approve), (application) =>
        text(
          `Ficha #${application.id} (${application.characterName}): ${application.status === 'approved' ? 'aprovada' : 'recusada'}.`,
        ),
      ),
  );
  tool(
    'run_legion_check',
    'Roda agora a conferência diária: relê cada personagem no site oficial, atualiza classe e apelido, avisa no canal dos oficiais quem saiu ou entrou na legião e refaz o #ranking. Leva alguns segundos por membro.',
    {},
    async () =>
      fromOutcome(
        await s.runAction({
          actor,
          action: 'legion.check',
          preview: 'legion.check',
          execute: async () => {
            const report = await s.legion.check();
            return report.length > 0 ? report.join('\n') : 'Conferência feita: nada mudou.';
          },
        }),
      ),
  );
  tool(
    'refresh_ranking',
    'Refaz o card do #ranking com os números guardados (sem consultar o site oficial).',
    {},
    async () =>
      fromOutcome(
        await s.runAction({
          actor,
          action: 'legion.check',
          preview: 'legion.check',
          execute: async () => {
            await s.legion.refreshRanking();
            return '#ranking atualizado.';
          },
        }),
      ),
  );

  // ---- Voice generators and server.yaml ------------------------------------------------------

  tool('list_voice_generators', 'Geradores de salas de voz (➕) do server.yaml.', {}, async () =>
    json(s.config.get().voiceGenerators),
  );
  tool(
    'upsert_voice_generator',
    'Cria ou edita um gerador de salas de voz no server.yaml. Depois rode apply_server_config.',
    {
      key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      category: z.string().describe('Chave da categoria no server.yaml, ex.: voice-rooms'),
      name: z.string().min(1).max(100).describe('Ex.: "➕ Raid"'),
      nameTemplate: z.string().includes('{n}').describe('Ex.: "Raid {n}"'),
      userLimit: z.number().int().min(0).max(99),
    },
    async (generator) =>
      fromOutcome(
        await s
          .runAction({
            actor,
            action: 'voice.generator.upsert',
            target: generator.key,
            params: generator,
            preview: generator.key,
            execute: async () => {
              s.config.upsertVoiceGenerator(generator);
              return `Gerador \`${generator.key}\` salvo no server.yaml. Rode apply_server_config para criá-lo no Discord.`;
            },
          })
          .catch(configFailure),
      ),
  );
  tool(
    'delete_voice_generator',
    'Remove um gerador do server.yaml (destrutivo). Depois rode apply_server_config com prune.',
    { key: z.string(), confirm },
    async (args) =>
      fromOutcome(
        await s
          .runAction({
            actor,
            action: 'voice.generator.delete',
            target: args.key,
            confirm: args.confirm === true,
            preview: `Remover o gerador ${args.key} do server.yaml. O canal só some do Discord ao rodar apply_server_config com prune: true.`,
            execute: async () => {
              s.config.deleteVoiceGenerator(args.key);
              return `Gerador \`${args.key}\` removido do server.yaml.`;
            },
          })
          .catch(configFailure),
      ),
  );

  tool(
    'reload_server_config',
    'Relê o server.yaml do disco sem reiniciar o bot (como /config reload). Um arquivo inválido é recusado e a configuração atual continua.',
    {},
    async () =>
      fromOutcome(
        await s
          .runAction({
            actor,
            action: 'config.reload',
            target: 'server.yaml',
            preview: 'config.reload',
            execute: async () => {
              const config = s.config.reload();
              const channels = config.categories.reduce((n, c) => n + c.channels.length, 0);
              return ptBR.config.reloaded(config.roles.length, channels);
            },
          })
          .catch(configFailure),
      ),
  );

  tool('get_server_config', 'Conteúdo atual do server.yaml (já validado).', {}, async () =>
    fromOutcome(
      await s.runAction({
        actor,
        action: 'setup.plan',
        preview: 'setup.plan',
        execute: async () => s.config.get(),
      }),
    ),
  );
  tool(
    'plan_server_config',
    'Mostra o que o /setup mudaria no Discord para ficar igual ao server.yaml (não altera nada).',
    { prune: z.boolean().optional() },
    async (args) =>
      fromOutcome(
        await s.runAction({
          actor,
          action: 'setup.plan',
          preview: 'setup.plan',
          execute: async () => formatPlan((await s.setup.plan(args.prune === true)).plan, 6000),
        }),
      ),
  );
  tool(
    'apply_server_config',
    'Aplica o server.yaml no Discord, como o /setup (destrutivo).',
    { prune: z.boolean().optional(), confirm },
    async (args) => {
      const prune = args.prune === true;
      const planned = await s.setup.plan(prune);
      return fromOutcome(
        await s.runAction({
          actor,
          action: 'setup.apply',
          confirm: args.confirm === true,
          target: 'server.yaml',
          params: { prune, ops: planned.plan.ops.length },
          preview: formatPlan(planned.plan, 3000),
          execute: async () => {
            const fresh = await s.setup.plan(prune);
            return formatResult(fresh.plan, await s.setup.apply(fresh), 3000);
          },
        }),
      );
    },
  );
}

/** The official Aion 2 site didn't answer: a refusal the user can retry, not a crash. */
function gameFailure(error: unknown): ServiceOutcome<never> {
  if (error instanceof GameApiError) return rejected(ptBR.profile.apiDown);
  throw error;
}

function configFailure(error: unknown): ServiceOutcome<string> {
  if (error instanceof ConfigError) return rejected(error.message);
  throw error;
}
