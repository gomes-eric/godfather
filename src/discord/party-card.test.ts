import { describe, expect, it } from 'vitest';
import { partyCard } from './party-card.js';

const view = {
  id: 7,
  activity: 'Caverna de Krao (Difícil)',
  startsAt: '21h',
  ownerId: 'leader',
  slots: 3,
  closed: false,
  members: [
    { id: 'leader', emoji: '✨' },
    { id: 'a', emoji: '🗡️' },
  ],
};

describe('partyCard', () => {
  it('lists members with class emoji and free slots, with Entrar/Sair/Fechar', () => {
    const { embeds, components } = partyCard(view);
    const embed = embeds[0]!.toJSON();
    expect(embed.title).toBe('🎯 Caverna de Krao (Difícil)');
    expect(embed.description).toContain('🕘 **21h**');
    expect(embed.fields?.[0]).toEqual({
      name: '👥 Vagas · 2/3',
      value: '`1.` ✨ <@leader>\n`2.` 🗡️ <@a>\n`3.` — vaga livre',
    });
    const buttons = components[0]!.toJSON().components as {
      custom_id: string;
      disabled?: boolean;
    }[];
    expect(buttons.map((b) => b.custom_id)).toEqual([
      'party:join:7',
      'party:leave:7',
      'party:close:7',
    ]);
  });

  it('disables Entrar when full and drops the buttons when closed', () => {
    const full = partyCard({ ...view, slots: 2 });
    const join = full.components[0]!.toJSON().components[0] as { disabled?: boolean };
    expect(join.disabled).toBe(true);
    expect(full.embeds[0]!.toJSON().title).toBe('✅ Caverna de Krao (Difícil)');
    expect(partyCard({ ...view, closed: true }).components).toEqual([]);
  });
});
