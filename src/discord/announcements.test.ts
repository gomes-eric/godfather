import { describe, expect, it } from 'vitest';
import type { OccurrenceView, ReminderMessage } from '../services/event-calendar.js';
import { agendaDescription, reminderCard } from './announcements.js';

const SP = 'America/Sao_Paulo';
const war: OccurrenceView = {
  occurrenceId: 12,
  title: 'Guerra do Abismo',
  emoji: '⚔️',
  description: null,
  startsAt: new Date('2026-10-27T00:00:00Z'),
  voiceChannelId: '555',
  ping: true,
  cancelled: false,
  eventId: null,
  templateKey: 'abyss-war',
};
const reminder = (overrides: Partial<ReminderMessage> = {}): ReminderMessage => ({
  occurrence: war,
  offsetMinutes: 30,
  rsvp: { yes: [], maybe: [], no: [] },
  classes: [],
  superseded: false,
  ...overrides,
});

describe('reminderCard', () => {
  it('pings, counts down, shows the Brasília time, room and attendance', () => {
    const card = reminderCard(
      reminder({
        rsvp: { yes: ['a', 'b'], maybe: ['c'], no: [] },
        classes: [
          { name: 'Clérigo', count: 2 },
          { name: 'Gladiador', count: 1 },
        ],
      }),
      SP,
    );

    expect(card.content).toBe('@everyone');
    expect(card.title).toBe('⚔️  Guerra do Abismo');
    expect(card.description).toBe('⏳ Começa **em 30 minutos** · <t:1793059200:R>');
    expect(card.fields).toEqual([
      { name: '🕘 Horário', value: '**21:00** · Brasília', inline: true },
      { name: '📍 Sala', value: '<#555>', inline: true },
      {
        name: '🙋 Presença',
        value: '✅ **2** vão · ❔ **1** talvez · ❌ **0** não vão\n*2 Clérigo, 1 Gladiador*',
        inline: false,
      },
    ]);
    expect(card.footer).toBe('M4F1A · evento #12');
    expect(card.rsvpOpen).toBe(true);
  });

  it('turns red and says it started for the 0-minute reminder; no ping when disabled', () => {
    const card = reminderCard(
      reminder({ occurrence: { ...war, ping: false }, offsetMinutes: 0 }),
      SP,
    );
    expect(card.content).toBe('');
    expect(card.description).toContain('Começou agora');
    expect(card.color).toBe(0xe0303a);
  });

  it('says a card posted for an earlier time was rescheduled, without stale attendance', () => {
    const card = reminderCard(reminder({ superseded: true }), SP);
    expect(card.description).toBe(
      '🕘 **Evento remarcado** para <t:1793059200:F> (<t:1793059200:R>). Um novo aviso sai antes do novo horário.',
    );
    expect(card.fields.map((f) => f.name)).toEqual(['🕘 Horário', '📍 Sala']);
    expect(card.rsvpOpen).toBe(true);
  });

  it('closes the RSVP of a cancelled event', () => {
    const card = reminderCard(reminder({ occurrence: { ...war, cancelled: true } }), SP);
    expect(card.description).toBe('🚫 **Evento cancelado.**');
    expect(card.fields.map((f) => f.name)).toEqual(['🕘 Horário', '📍 Sala']);
    expect(card.rsvpOpen).toBe(false);
  });
});

describe('agendaDescription', () => {
  const now = new Date('2026-10-25T06:30:00Z');

  it('groups by day with Hoje/Amanhã labels and Brasília times', () => {
    const nahma = {
      ...war,
      occurrenceId: 7,
      title: 'Nahma',
      emoji: '🐉',
      voiceChannelId: null,
      startsAt: new Date('2026-10-26T00:00:00Z'),
    };
    const bosses = { ...war, occurrenceId: 13, title: 'Chefes', emoji: '👹', voiceChannelId: null };
    const text = agendaDescription([nahma, war, bosses], SP, now);

    expect(text).toBe(
      [
        'Próximos 7 dias · horários de Brasília',
        '',
        '🗓️ **Hoje** · domingo, 25/10',
        '`21:00` 🐉 **Nahma** · <t:1792972800:R> · `#7`',
        '',
        '🗓️ **Amanhã** · segunda-feira, 26/10',
        '`21:00` ⚔️ **Guerra do Abismo** · <#555> · <t:1793059200:R> · `#12`',
        '`21:00` 👹 **Chefes** · <t:1793059200:R> · `#13`',
      ].join('\n'),
    );
  });

  it('says when there is nothing scheduled', () => {
    expect(agendaDescription([], SP, now)).toContain('Nenhum evento nos próximos 7 dias');
  });
});
