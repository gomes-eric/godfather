import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadServerConfig, parseServerConfig } from './loader.js';
import { channelNameByKey, tierRoleNames } from './schema.js';

const repoServerYaml = fileURLToPath(new URL('../../server.yaml', import.meta.url));

const minimal = `
settings:
  audit: { channel: audit-log }
roles:
  - { key: commander, name: Comandante, tier: commander }
categories:
  - key: officers
    name: OFICIAIS
    channels:
      - { key: audit-log, name: audit-log }
`;

describe('server.yaml', () => {
  it('the repository file is valid', () => {
    const config = loadServerConfig(repoServerYaml);

    expect(tierRoleNames(config)).toEqual({
      commander: 'Comandante',
      officer: 'Oficial',
      soldier: 'Soldado',
    });
    expect(channelNameByKey(config, config.settings.audit.channel)).toBe('audit-log');
  });

  it('keeps keys the schema does not know about yet', () => {
    const config = parseServerConfig(`${minimal}\nvoiceGenerators: []\n`);
    expect(config).toHaveProperty('voiceGenerators', []);
  });

  it('rejects an audit channel key that does not exist', () => {
    expect(() => parseServerConfig(minimal.replace('channel: audit-log', 'channel: nope'))).toThrow(
      /settings\.audit\.channel: unknown channel key "nope"/,
    );
  });

  it('rejects two roles with the same tier', () => {
    const duplicated = minimal.replace(
      '  - { key: commander, name: Comandante, tier: commander }',
      '  - { key: a, name: A, tier: officer }\n  - { key: b, name: B, tier: officer }',
    );
    expect(() => parseServerConfig(duplicated)).toThrow(/tier "officer" is assigned to more/);
  });

  it('reports malformed YAML as a ConfigError', () => {
    expect(() => parseServerConfig('roles: [')).toThrow(ConfigError);
  });
});
