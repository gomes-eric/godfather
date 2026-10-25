import { describe, expect, it } from 'vitest';
import type { EquipmentItem } from '../core/game-character.js';
import { profileCard } from './profile-card.js';

const item = (group: EquipmentItem['group'], name: string, enchantLevel = 10): EquipmentItem => ({
  name,
  slot: name,
  group,
  enchantLevel,
  exceedLevel: 0,
  grade: 'Unique',
});

const profile = {
  id: 'x',
  name: 'Padrinho',
  serverId: 2403,
  className: 'Clérigo',
  level: 45,
  combatPower: 143232,
  itemLevel: 2656,
  legion: 'M4F1A',
  title: 'Pisando em Asas Brancas',
  avatarUrl: 'https://profileimg.plaync.com/x.png',
};

describe('profileCard', () => {
  it('shows the numbers, legion and gear grouped by kind', () => {
    const embed = profileCard(
      {
        profile,
        equipment: [
          item('weapons', 'Martelo', 15),
          item('armor', 'Peitoral'),
          item('arcana', 'Cálice', 2),
        ],
      },
      { classEmoji: '✨', color: 0xe6c46a, serverName: 'Triniel' },
    ).toJSON();

    expect(embed.title).toBe('Padrinho');
    expect(embed.description).toContain('✨ **Clérigo** · Nível 45');
    expect(embed.description).toContain('M4F1A');
    expect(embed.fields?.[0]?.value).toBe('**143.232**');
    expect(embed.fields?.map((f) => f.name)).toEqual([
      '⚔️ Poder de combate',
      '🎚️ Nível de item',
      '🗡️ Armas',
      '🛡️ Armaduras',
      '🔮 Runas e arcanas',
    ]);
    expect(embed.fields?.[2]?.value).toBe('+15 Martelo');
    expect(embed.thumbnail?.url).toBe(profile.avatarUrl);
  });

  it('copes with no legion, no title and no gear', () => {
    const embed = profileCard(
      { profile: { ...profile, legion: '', title: null, combatPower: null }, equipment: [] },
      { serverName: 'Triniel' },
    ).toJSON();
    expect(embed.description).toContain('Sem legião');
    expect(embed.fields?.[0]?.value).toBe('—');
    expect(embed.fields?.at(-1)?.value).toBe('Nenhum item equipado.');
  });
});
