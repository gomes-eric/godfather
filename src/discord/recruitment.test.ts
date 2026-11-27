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
  kind: 'member',
  requestedKind: 'member',
  origin: 'form',
  allianceLegion: null,
  note: null,
  duplicateOf: null,
  previousStanding: null,
  status: 'pending',
  messageId: null,
  threadId: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: new Date('2026-10-26T00:00:00Z'),
};
const look = {
  classEmoji: '✨',
  avatarUrl: null,
  legionName: 'M4F1A',
  applicantName: 'padrinho_discord',
  newAlliance: false,
  previousStanding: null,
};

describe('applicationCard', () => {
  it('shows the character and the type, with Aprovar/Recusar/Mudar while pending', () => {
    const { embeds, components } = applicationCard(application, look);
    const embed = embeds[0]!.toJSON();
    expect(embed.title).toBe('📝 Ficha · Padrinho');
    expect(embed.description).toContain('Tipo: **⚔️ Membro**');
    expect(embed.fields?.map((f) => f.value)).toEqual([
      '✨ Clérigo · Nv 45',
      '⚔️ 100.000 · 🎚️ 2.000',
      'Sem legião',
    ]);
    const ids = (components[0]!.toJSON().components as { custom_id: string }[]).map(
      (c) => c.custom_id,
    );
    expect(ids).toEqual(['recruit:approve:3', 'recruit:reject:3', 'recruit:change:3']);
  });

  it('drops the buttons and names who decided', () => {
    const { embeds, components } = applicationCard(
      { ...application, status: 'approved', decidedBy: 'officer' },
      look,
    );
    expect(components).toEqual([]);
    expect(embeds[0]!.toJSON().description).toContain('Aprovada por <@officer>');
  });

  it('warns about a character someone else has and a new alliance', () => {
    const description = applicationCard(
      { ...application, kind: 'ally', allianceLegion: 'Lagta', duplicateOf: 'u9' },
      { ...look, newAlliance: true },
    ).embeds[0]!.toJSON().description;
    expect(description).toContain('🤝 Aliança · Lagta');
    expect(description).toContain('Escolheu na ficha: ⚔️ Membro');
    expect(description).toContain('Pedido de aliança nova');
    expect(description).toContain('Personagem já cadastrado** para <@u9>');
  });

  it('shows a Parceiro without a character by their Discord name', () => {
    const embed = applicationCard(
      { ...application, kind: 'partner', characterId: null, characterName: null, note: 'amigo' },
      look,
    ).embeds[0]!.toJSON();
    expect(embed.title).toBe('📝 Ficha · padrinho_discord');
    expect(embed.fields?.map((f) => f.value)).toEqual(['Não informou', 'amigo']);
  });
});
