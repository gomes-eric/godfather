import { describe, expect, it } from 'vitest';
import type { Application } from '../db/applications.js';
import { applicationCard } from './recruitment.js';

const application: Application = {
  id: 3,
  userId: 'u1',
  characterId: 'c1',
  characterName: 'Padrinho',
  serverId: 2403,
  className: 'Clérigo',
  level: 45,
  legion: '',
  combatPower: 100000,
  itemLevel: 2000,
  status: 'pending',
  messageId: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: new Date('2026-10-26T00:00:00Z'),
};
const look = { classEmoji: '✨', avatarUrl: null, legionName: 'M4F1A' };

describe('applicationCard', () => {
  it('shows the character from the game, with Aprovar/Recusar while pending', () => {
    const { embeds, components } = applicationCard(application, look);
    const embed = embeds[0]!.toJSON();
    expect(embed.title).toBe('📝 Ficha da legião · Padrinho');
    expect(embed.fields?.map((f) => f.value)).toEqual([
      '✨ Clérigo · Nv 45',
      '⚔️ 100.000 · 🎚️ 2.000',
      'Sem legião',
    ]);
    const ids = (components[0]!.toJSON().components as { custom_id: string }[]).map(
      (c) => c.custom_id,
    );
    expect(ids).toEqual(['recruit:approve:3', 'recruit:reject:3']);
  });

  it('drops the buttons and names who decided', () => {
    const { embeds, components } = applicationCard(
      { ...application, status: 'approved', decidedBy: 'officer' },
      look,
    );
    expect(components).toEqual([]);
    expect(embeds[0]!.toJSON().description).toContain('Aprovada por <@officer>');
  });
});
