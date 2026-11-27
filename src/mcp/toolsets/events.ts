import { z } from 'zod';
import { CLOCK_PATTERN } from '../../config/schema.js';
import { parseDays } from '../../services/event.service.js';
import { fail, json, fromOutcome, confirm, type ToolKit } from './kit.js';

export function registerEventTools({ tool, channelId, s, actor }: ToolKit): void {
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
      const voiceChannelId = args.voiceChannel ? channelId(args.voiceChannel, true) : undefined;
      return s.events.create(actor, {
        title: args.title,
        when: args.when,
        ...(args.description && { description: args.description }),
        ...(args.emoji && { emoji: args.emoji }),
        ...(voiceChannelId && { voiceChannelId }),
        ...(args.ping !== undefined && { ping: args.ping }),
      });
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
    async ({ id, ...edit }) => s.events.edit(actor, id, edit),
  );
  tool(
    'cancel_event',
    'Cancela um evento, ou só uma data de um recorrente (destrutivo).',
    { id: z.number().int(), confirm },
    async (args) => s.events.cancel(actor, args.id, args.confirm === true),
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
      time: z.string().regex(CLOCK_PATTERN).optional().describe('HH:MM, horário de Brasília'),
      days: z.string().optional().describe('"seg qui sáb", "mon,thu,sat" ou "todo dia"'),
      title: z.string().min(1).max(100).optional(),
      enabled: z.boolean().optional(),
    },
    async ({ key, days, ...rest }) => {
      const parsedDays = days ? parseDays(days) : undefined;
      if (days && !parsedDays) return fail(`Dias inválidos: "${days}"`);
      return s.events.updateTemplate(actor, key, {
        ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
        ...(parsedDays && { days: parsedDays }),
      });
    },
  );
}
