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

describe('ConfigStore voice generators', () => {
  let path: string;

  beforeEach(() => {
    path = join(mkdtempSync(join(tmpdir(), 'padrinho-')), 'server.yaml');
    copyFileSync(repoServerYaml, path);
  });

  it('adds, updates and removes a generator in server.yaml', () => {
    const store = new ConfigStore(path);
    const raid = {
      key: 'gen-raid',
      category: 'voice-rooms',
      name: '➕ Raid',
      nameTemplate: 'Raid {n}',
      userLimit: 8,
    };

    store.upsertVoiceGenerator(raid);
    expect(new ConfigStore(path).get().voiceGenerators.at(-1)).toEqual(raid);

    store.upsertVoiceGenerator({ ...raid, userLimit: 12 });
    expect(new ConfigStore(path).get().voiceGenerators.filter((g) => g.key === 'gen-raid')).toEqual(
      [{ ...raid, userLimit: 12 }],
    );

    store.deleteVoiceGenerator('gen-raid');
    expect(new ConfigStore(path).get().voiceGenerators.some((g) => g.key === 'gen-raid')).toBe(
      false,
    );
    expect(readFileSync(path, 'utf8')).toContain('# Join-to-create generators');
  });

  it('refuses a generator pointing at an unknown category', () => {
    const store = new ConfigStore(path);
    expect(() =>
      store.upsertVoiceGenerator({
        key: 'gen-x',
        category: 'nope',
        name: 'x',
        nameTemplate: 'X {n}',
        userLimit: 0,
      }),
    ).toThrow(ConfigError);
  });
});

describe('ConfigStore alliances', () => {
  let path: string;

  beforeEach(() => {
    path = join(mkdtempSync(join(tmpdir(), 'padrinho-')), 'server.yaml');
    copyFileSync(repoServerYaml, path);
  });

  it('adds and removes alliances, one per line, keeping the comments', () => {
    const store = new ConfigStore(path);
    store.addAlliance({ key: 'ally-noxus', legion: 'Noxus' });
    store.addAlliance({ key: 'ally-lagta', legion: 'Lagta' });

    const text = readFileSync(path, 'utf8');
    expect(text).toContain(
      'alliances:\n  - { key: ally-noxus, legion: Noxus }\n  - { key: ally-lagta, legion: Lagta }',
    );
    expect(text).toContain('# Allied legions (/alliance add');
    expect(new ConfigStore(path).get().alliances.map((a) => a.legion)).toEqual(['Noxus', 'Lagta']);

    store.removeAlliance('ally-noxus');
    store.removeAlliance('ally-lagta');
    expect(readFileSync(path, 'utf8')).toContain('alliances: []');
    expect(() => store.removeAlliance('ally-noxus')).toThrow(ConfigError);
  });

  it('refuses a legion listed twice or a key that is also a role', () => {
    const store = new ConfigStore(path);
    store.addAlliance({ key: 'ally-noxus', legion: 'Noxus' });
    expect(() => store.addAlliance({ key: 'ally-noxus-2', legion: 'NOXUS' })).toThrow(ConfigError);
    expect(() => store.addAlliance({ key: 'partner', legion: 'Lagta' })).toThrow(ConfigError);
    expect(store.get().alliances).toHaveLength(1);
  });
});
