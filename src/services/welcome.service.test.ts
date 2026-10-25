import type { EmbedBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { renderWelcome, welcomeCard } from './welcome.service.js';

describe('renderWelcome', () => {
  const channels: Record<string, string> = { recruitment: '111', rules: '222' };

  it('fills the member mention and channel links', () => {
    const text = renderWelcome(
      'Bem-vindo(a), {member}! Fale em {channel:recruitment} e leia {channel:rules}.\n',
      '42',
      (key) => channels[key],
    );

    expect(text).toBe('Bem-vindo(a), <@42>! Fale em <#111> e leia <#222>.');
  });

  it('leaves unknown channel keys visible', () => {
    expect(renderWelcome('Veja {channel:nope}', '42', () => undefined)).toBe('Veja #nope');
  });
});

describe('welcomeCard', () => {
  const channels: Record<string, string> = {
    recruitment: '111',
    rules: '222',
    'visitor-qa': '333',
  };
  const newcomer = {
    id: '42',
    displayName: 'Lekyh',
    avatarUrl: 'https://cdn.discordapp.com/avatar.png',
    memberCount: 37,
  };

  it('builds the card from server.yaml, with every link filled in', async () => {
    const { loadServerConfig } = await import('../config/loader.js');
    const { fileURLToPath } = await import('node:url');
    const config = loadServerConfig(fileURLToPath(new URL('../../server.yaml', import.meta.url)));

    const card = welcomeCard(config.settings.welcome, newcomer, (key) => channels[key]);
    const embed = (card.embeds![0] as EmbedBuilder).toJSON();
    const text = JSON.stringify(embed);

    expect(card.content).toContain('<@42>');
    expect(card.allowedMentions).toEqual({ users: ['42'] });
    expect(embed.title).toBe('🌹 Bem-vindo(a) à M4F1A!');
    expect(embed.description).toContain('<@42>');
    for (const id of ['111', '222', '333']) expect(text).toContain(`<#${id}>`);
    expect(text).not.toMatch(/{(member|channel:)/);
    expect(embed.thumbnail?.url).toBe(newcomer.avatarUrl);
    expect(embed.footer?.text).toContain('37');
  });

  it('works without a title or steps', () => {
    const card = welcomeCard(
      { channel: 'welcome', autoRole: 'visitor', message: 'Oi {member}', steps: [] },
      newcomer,
      () => undefined,
    );
    const embed = (card.embeds![0] as EmbedBuilder).toJSON();
    expect(embed.title).toBeUndefined();
    expect(embed.fields ?? []).toEqual([]);
    expect(embed.description).toBe('Oi <@42>');
  });
});
