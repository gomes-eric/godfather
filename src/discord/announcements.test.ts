import { describe, expect, it } from 'vitest';
import type { OccurrenceView } from '../services/reminder.scheduler.js';
import { agendaDescription, reminderContent } from './announcements.js';

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

describe('reminderContent', () => {
  it('pings, links the room and shows the RSVP counts', () => {
    const text = reminderContent(
      { occurrence: war, offsetMinutes: 30, rsvp: { yes: ['a', 'b'], maybe: ['c'], no: [] } },
      '2 Clérigo',
    );
    expect(text.split('\n')).toEqual([
      '@everyone',
      '⚔️ **Guerra do Abismo** começa em **30 minutos** (<t:1793059200:t> · <t:1793059200:R>)',
      '📍 Sala: <#555>',
      '✅ 2 · ❔ 1 · ❌ 0  (2 Clérigo)',
    ]);
  });

  it('says it started for the 0-minute reminder and skips the ping when disabled', () => {
    const text = reminderContent(
      {
        occurrence: { ...war, ping: false },
        offsetMinutes: 0,
        rsvp: { yes: [], maybe: [], no: [] },
      },
      '',
    );
    expect(text).not.toContain('@everyone');
    expect(text).toContain('**Guerra do Abismo** começou!');
  });
});

describe('agendaDescription', () => {
  it('groups by day in São Paulo time', () => {
    const bosses = { ...war, occurrenceId: 13, title: 'Chefes', emoji: '👹', voiceChannelId: null };
    const nahma = {
      ...war,
      occurrenceId: 14,
      title: 'Nahma',
      emoji: '🐉',
      startsAt: new Date('2026-10-31T00:00:00Z'), // Fri 30/10 21:00 BRT
    };
    const text = agendaDescription([war, bosses, nahma], 'America/Sao_Paulo');
    expect(text).toBe(
      [
        '**seg, 26/10**',
        '<t:1793059200:t> ⚔️ Guerra do Abismo · <#555> `#12`',
        '<t:1793059200:t> 👹 Chefes `#13`',
        '',
        '**sex, 30/10**',
        '<t:1793404800:t> 🐉 Nahma · <#555> `#14`',
      ].join('\n'),
    );
  });

  it('says when there is nothing scheduled', () => {
    expect(agendaDescription([], 'America/Sao_Paulo')).toBe('Nenhum evento nos próximos 7 dias.');
  });
});

describe('normalizeClock', () => {
  it('accepts the ways people type a time', async () => {
    const { normalizeClock } = await import('./commands/event.js');
    expect(['21', '21h', '9:30', '21:00', '9h30'].map(normalizeClock)).toEqual([
      '21:00',
      '21:00',
      '09:30',
      '21:00',
      '09:30',
    ]);
    expect(normalizeClock('meio-dia')).toBe('meio-dia');
  });
});
