import { describe, expect, it } from 'vitest';
import { auditCard, formatDetails } from './audit-publisher.js';

const base = {
  id: 42,
  at: new Date('2026-10-25T09:00:00Z'),
  actor: {
    userId: '302857660712353794',
    tier: 'officer' as const,
    source: 'mcp' as const,
    harness: 'claude-code',
  },
};

describe('auditCard', () => {
  it('titles the entry in Portuguese and shows who, how and the outcome', () => {
    const card = auditCard({
      ...base,
      action: 'member.kick',
      target: 'Fulano',
      params: { userId: '111111111111111111', reason: 'flood' },
      result: 'ok',
    });

    expect(card.title).toBe('👢 Expulsão');
    expect(card.color).toBe(0x4fb286);
    expect(card.fields).toEqual([
      { name: '👤 Quem', value: '<@302857660712353794>', inline: true },
      { name: '🛠️ Via', value: 'IA via MCP (claude-code)', inline: true },
      { name: '📌 Resultado', value: '✅ Executado', inline: true },
      { name: '🎯 Alvo', value: 'Fulano', inline: false },
      {
        name: '📝 Detalhes',
        value: '• **Membro:** <@111111111111111111>\n• **Motivo:** flood',
        inline: false,
      },
    ]);
    expect(card.footer).toBe('#42 · member.kick');
  });

  it('marks denied attempts in red and falls back to the action key', () => {
    const card = auditCard({ ...base, action: 'something.new', result: 'denied' });
    expect(card.title).toBe('something.new');
    expect(card.color).toBe(0xe0303a);
  });
});

describe('formatDetails', () => {
  it('renders channels, booleans and dates readably', () => {
    expect(
      formatDetails({
        channelId: '222222222222222222',
        prune: false,
        startsAt: '2026-10-27T00:00:00.000Z',
        empty: '',
      }),
    ).toBe(
      [
        '• **Canal:** <#222222222222222222>',
        '• **Remover sobras:** não',
        '• **Início:** <t:1793059200:f>',
      ].join('\n'),
    );
  });

  it('caps the list at 10 lines', () => {
    const many = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, i]));
    const lines = formatDetails(many).split('\n');
    expect(lines).toHaveLength(11);
    expect(lines.at(-1)).toBe('• … +3');
  });
});
