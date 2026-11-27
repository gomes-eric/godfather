import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadServerConfig } from '../config/loader.js';
import { buildDesiredState, PANEL_KEYS, RECRUIT_APPLY_ID } from '../setup/desired.js';

const repoConfig = loadServerConfig(fileURLToPath(new URL('../../server.yaml', import.meta.url)));

describe('#recrutamento panel', () => {
  it('explains the three kinds of application, with the Enviar minha ficha button', () => {
    const panel = buildDesiredState(repoConfig).panels.find(
      (p) => p.key === PANEL_KEYS.recruitment,
    )!;
    expect(panel.channelKey).toBe('recruitment');
    expect(panel.buttons.map((b) => b.customId)).toEqual([RECRUIT_APPLY_ID]);
    expect(panel.description).toContain('{channel:visitor-qa}');
    expect(panel.description).toContain('⚔️ **Membro**: para quem já está na M4F1A');
    expect(panel.description).toContain('🤝 **Aliança**');
    expect(panel.description).toContain('💬 **Parceiro**');
  });
});
