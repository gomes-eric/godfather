import { describe, expect, it } from 'vitest';
import { renderWelcome } from './welcome.service.js';

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

  it('renders the welcome message from server.yaml', async () => {
    const { loadServerConfig } = await import('../config/loader.js');
    const { fileURLToPath } = await import('node:url');
    const config = loadServerConfig(fileURLToPath(new URL('../../server.yaml', import.meta.url)));

    const text = renderWelcome(config.settings.welcome.message, '42', (key) => channels[key]);
    expect(text).toContain('<@42>');
    expect(text).toContain('<#111>');
    expect(text).not.toContain('{');
  });
});
