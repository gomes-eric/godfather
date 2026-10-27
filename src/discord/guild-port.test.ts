import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadServerConfig } from '../config/loader.js';
import { buildDesiredState, PANEL_KEYS, RECRUIT_APPLY_ID } from '../setup/desired.js';
import { groupButtonRows } from './guild-port.js';

const repoConfig = loadServerConfig(fileURLToPath(new URL('../../server.yaml', import.meta.url)));

describe('groupButtonRows', () => {
  it('puts buttons with the same row on one line, in row order', () => {
    const rows = groupButtonRows([
      { id: 'a', row: 1 },
      { id: 'b', row: 0 },
      { id: 'c', row: 1 },
      { id: 'd' },
    ]);
    expect(rows.map((row) => row.map((b) => b.id))).toEqual([['b'], ['a', 'c'], ['d']]);
  });

  it('never exceeds 5 buttons per line or 5 lines', () => {
    const many: { id: number; row?: number }[] = Array.from({ length: 30 }, (_, i) => ({ id: i }));
    const rows = groupButtonRows(many);
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.length <= 5)).toBe(true);
  });
});

describe('#recrutamento panel', () => {
  it('explains the form is for members and newcomers, with the Enviar minha ficha button', () => {
    const panel = buildDesiredState(repoConfig).panels.find(
      (p) => p.key === PANEL_KEYS.recruitment,
    )!;
    expect(panel.channelKey).toBe('recruitment');
    expect(panel.buttons.map((b) => b.customId)).toEqual([RECRUIT_APPLY_ID]);
    expect(panel.description).toContain('{channel:visitor-qa}');
    expect(panel.description).toContain('Já está na M4F1A no jogo?');
  });
});
