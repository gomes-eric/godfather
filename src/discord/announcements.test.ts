import { describe, expect, it } from 'vitest';
import type { OccurrenceView } from '../services/reminder.scheduler.js';
import { agendaDescription, reminderCard } from './announcements.js';

const SP = 'America/Sao_Paulo';
const war: OccurrenceView = {
  occurrenceId: 12,
  title: 'Guerra do Abismo',
  emoji: '⚔️',
  description: null,
  startsAt: new Date('2026-10-27T00:00:00Z'), // Mon 26/10 21:00 BRT
  voiceChannelId: '555',
  ping: true,
  cancelled: false,
  eventId: null,
  templateKey: 'abyss-war',
};
const noVotes = { yes: [], maybe: [], no: [] };

describe('reminderCard', () => {
  it('pings, counts down, shows the Brasília time, room and attendance', () => {
    const card = reminderCard(
      { occurrence: war, offsetMinutes: 30, rsvp: { yes: ['a', 'b'], maybe: ['c'], no: [] } },
      '2 Clérigo',
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
        value: '✅ **2** vão · ❔ **1** talvez · ❌ **0** não vão\n*2 Clérigo*',
        inline: false,
      },
    ]);
    expect(card.footer).toBe('M4F1A · evento #12');
  });

  it('turns red and says it started for the 0-minute reminder; no ping when disabled', () => {
    const card = reminderCard(
      { occurrence: { ...war, ping: false }, offsetMinutes: 0, rsvp: noVotes },
      '',
      SP,
    );
    expect(card.content).toBe('');
    expect(card.description).toContain('Começou agora');
    expect(card.color).toBe(0xe0303a);
  });
});

describe('agendaDescription', () => {
  // Sunday 25/10 03:30 in São Paulo.
  const now = new Date('2026-10-25T06:30:00Z');

  it('groups by day with Hoje/Amanhã labels and Brasília times', () => {
    const nahma = {
      ...war,
      occurrenceId: 7,
      title: 'Nahma',
      emoji: '🐉',
      voiceChannelId: null,
      startsAt: new Date('2026-10-26T00:00:00Z'), // Sun 25/10 21:00 BRT
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
