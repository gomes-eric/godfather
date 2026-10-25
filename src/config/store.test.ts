import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from './loader.js';
import { ConfigStore } from './store.js';

const repoServerYaml = fileURLToPath(new URL('../../server.yaml', import.meta.url));

describe('ConfigStore.updateEventTemplate', () => {
  let path: string;

  beforeEach(() => {
    path = join(mkdtempSync(join(tmpdir(), 'padrinho-')), 'server.yaml');
    copyFileSync(repoServerYaml, path);
  });

  it('writes the change back, keeping comments and quoting', () => {
    const store = new ConfigStore(path);
    store.updateEventTemplate('abyss-war', { time: '20:00', days: ['tue', 'fri'] });

    const text = readFileSync(path, 'utf8');
    expect(text).toContain('time: "20:00"');
    expect(text).toContain('days: [ tue, fri ]');
    expect(text).toContain('# Recurring events. Times are America/Sao_Paulo');
    expect(store.get().eventTemplates.find((t) => t.key === 'abyss-war')).toMatchObject({
      time: '20:00',
      days: ['tue', 'fri'],
    });
    // Only that template changed.
    expect(
      new ConfigStore(path).get().eventTemplates.find((t) => t.key === 'abyss-bosses')?.time,
    ).toBe('21:30');
  });

  it('refuses an invalid edit without touching the file', () => {
    const store = new ConfigStore(path);
    const before = readFileSync(path, 'utf8');

    expect(() => store.updateEventTemplate('abyss-war', { time: '25:00' })).toThrow(ConfigError);
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(store.get().eventTemplates.find((t) => t.key === 'abyss-war')?.time).toBe('21:00');
  });

  it('reports an unknown template', () => {
    expect(() => new ConfigStore(path).updateEventTemplate('nope', { enabled: false })).toThrow(
      /not found/,
    );
  });
});
