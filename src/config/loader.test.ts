import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadServerConfig, parseServerConfig } from './loader.js';
import { channelNameByKey, tierRoleKeys, tierRoleNames } from './schema.js';

const repoServerYaml = fileURLToPath(new URL('../../server.yaml', import.meta.url));

export const minimalYaml = `
settings:
  botName: Padrinho
  timezone: America/Sao_Paulo
  community: { enable: true, rulesChannel: rules, updatesChannel: staff }
  afk: { channel: afk, timeoutSeconds: 900 }
  welcome: { channel: rules, autoRole: visitor, message: "Oi {member}" }
  rules: { channel: rules, message: "Seja legal." }
  rolePicker: { channel: rules }
  characters: { region: la, serverId: 2403, legion: M4F1A, recruitmentChannel: rules }
  audit: { channel: staff }
  musicGuard: { channel: rules }
  eventDefaults: { announceChannel: rules, agendaChannel: rules, reminderOffsetsMinutes: [30, 0] }
roles:
  - { key: commander, name: Comandante, tier: commander, color: "#E0303A", permissions: [Administrator] }
  - { key: visitor, name: Visitante, tier: visitor }
categories:
  - key: main
    name: MAIN
    access: { view: everyone, write: everyone }
    channels:
      - { key: rules, type: text, name: regras }
      - { key: staff, type: text, name: staff, access: { view: commander } }
      - { key: afk, type: voice, name: AFK }
`;

describe('server.yaml', () => {
  it('the repository file is valid', () => {
    const config = loadServerConfig(repoServerYaml);

    expect(tierRoleNames(config)).toEqual({
      commander: 'Comandante',
      officer: 'Oficial',
      soldier: 'Soldado',
    });
    expect(tierRoleKeys(config)).toEqual({
      commander: 'commander',
      officer: 'officer',
      soldier: 'soldier',
    });
    expect(channelNameByKey(config, config.settings.audit.channel)).toBe('audit-log');
    expect(config.voiceGenerators.map((g) => g.key)).toContain('gen-abyss');
  });

  it('parses colors into numbers and applies defaults', () => {
    const config = parseServerConfig(minimalYaml);
    const commander = config.roles[0];

    expect(commander?.color).toBe(0xe0303a);
    expect(commander?.hoist).toBe(false);
    expect(config.settings.musicGuard.commandPrefixes).toEqual([]);
    expect(config.voiceGenerators).toEqual([]);
  });

  it('keeps sections later phases own', () => {
    const config = parseServerConfig(`${minimalYaml}\neventTemplates: []\n`);
    expect(config).toHaveProperty('eventTemplates', []);
  });

  it('rejects a settings channel key that does not exist', () => {
    expect(() =>
      parseServerConfig(
        minimalYaml.replace('audit: { channel: staff }', 'audit: { channel: nope }'),
      ),
    ).toThrow(/settings\.audit\.channel: "nope" is not a channel key/);
  });

  it('rejects an AFK channel that is not a voice channel', () => {
    expect(() =>
      parseServerConfig(minimalYaml.replace('afk: { channel: afk', 'afk: { channel: rules')),
    ).toThrow(/settings\.afk\.channel/);
  });

  it('rejects two roles with the same tier', () => {
    expect(() =>
      parseServerConfig(
        minimalYaml.replace(
          '{ key: visitor, name: Visitante, tier: visitor }',
          '{ key: x, name: X, tier: commander }',
        ),
      ),
    ).toThrow(/tier "commander" is assigned to more than one role/);
  });

  it('rejects unknown Discord permissions', () => {
    expect(() => parseServerConfig(minimalYaml.replace('[Administrator]', '[BeAwesome]'))).toThrow(
      /unknown Discord permission/,
    );
  });

  it('rejects duplicate channel keys', () => {
    expect(() =>
      parseServerConfig(
        minimalYaml.replace('{ key: afk, type: voice', '{ key: rules, type: voice'),
      ),
    ).toThrow(/duplicate channel key "rules"/);
  });

  it('reports malformed YAML as a ConfigError', () => {
    expect(() => parseServerConfig('roles: [')).toThrow(ConfigError);
  });
});
