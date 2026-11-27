import { describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
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
  characterTakenBy: null,
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

const values = (embed: ReturnType<EmbedBuilder['toJSON']>) =>
  Object.fromEntries((embed.fields ?? []).map((f) => [f.name, f.value]));

describe('applicationCard', () => {
  it('lays out who, type and status, then the character, with Aprovar/Recusar/Mudar', () => {
    const { embeds, components } = applicationCard(application, look);
    const embed = embeds[0]!.toJSON();
    expect(embed.title).toBe('📝 Ficha · Padrinho');
    expect(embed.description).toBeUndefined();
    expect(embed.fields?.map((f) => [f.name, f.value])).toEqual([
      ['👤 Candidato', '<@u1>'],
      ['📌 Tipo', '⚔️ Membro'],
      ['📋 Situação', '⏳ Aguardando'],
      ['🎮 Classe', '✨ Clérigo · Nv 45'],
      ['📊 Poder', '⚔️ 100.000 · 🎚️ 2.000'],
      ['🏰 Legião atual', 'Sem legião'],
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
    expect(values(embeds[0]!.toJSON())['📋 Situação']).toBe('✅ Aprovada\n-# por <@officer>');
  });

  it('puts the warnings first, each as its own quote', () => {
    const embed = applicationCard(
      { ...application, kind: 'ally', allianceLegion: 'Lagta', characterTakenBy: 'u9' },
      { ...look, newAlliance: true },
    ).embeds[0]!.toJSON();
    expect(values(embed)['📌 Tipo']).toBe('🤝 Aliança · Lagta\n-# escolheu ⚔️ Membro');
    const [alliance, duplicate] = embed.description!.split('\n\n');
    expect(alliance).toMatch(/^> 🆕 \*\*Pedido de aliança nova\*\*\n> /);
    expect(duplicate).toMatch(/^> ⚠️ \*\*Personagem já cadastrado\*\* para <@u9>\n> /);
  });

  it('shows a Parceiro without a character by their Discord name', () => {
    const embed = applicationCard(
      { ...application, kind: 'partner', characterId: null, characterName: null },
      look,
    ).embeds[0]!.toJSON();
    expect(embed.title).toBe('📝 Ficha · padrinho_discord');
    expect(values(embed)['🎮 Personagem']).toBe('Não informou');
    expect(embed.fields).toHaveLength(4);
  });
});
