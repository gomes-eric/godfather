import { describe, expect, it } from 'vitest';
import { RANKING_SELECT_ID, rankingMenu } from './ranking-menu.js';

const row = (userId: string, combatPower: number) => ({
  userId,
  name: `Membro ${userId}`,
  classEmoji: '✨',
  combatPower,
  itemLevel: 2000,
});

describe('rankingMenu', () => {
  it('lists the top 10 in board order, with the member id as the value', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(String(i), i * 1000));
    const menu = rankingMenu(rows)[0]!.toJSON().components[0] as {
      custom_id: string;
      options: { label: string; value: string; description: string }[];
    };
    expect(menu.custom_id).toBe(RANKING_SELECT_ID);
    expect(menu.options).toHaveLength(10);
    expect(menu.options[0]).toMatchObject({
      label: '1. Membro 11',
      value: '11',
      description: 'Ver perfil · ⚔️ 11.000 · 🎚️ 2.000',
    });
  });

  it('has no menu when nobody is on the board', () => {
    expect(rankingMenu([])).toEqual([]);
  });
});
