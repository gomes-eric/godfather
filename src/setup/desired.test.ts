import { fileURLToPath } from 'node:url';
import { PermissionFlagsBits as P } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { loadServerConfig } from '../config/loader.js';
import { buildDesiredState } from './desired.js';

const config = loadServerConfig(fileURLToPath(new URL('../../server.yaml', import.meta.url)));
const desired = buildDesiredState(config);
const botsOn = (channelKey: string) =>
  desired.channels.find((c) => c.key === channelKey)!.overwrites.find((o) => o.target === 'bots');

describe('music bots only in #musica and the voice chats', () => {
  it('hides every other text channel from the Bot role', () => {
    for (const key of ['general', 'rules', 'recruitment', 'news', 'officers']) {
      expect(botsOn(key)?.deny ?? 0n, key).toBe(P.ViewChannel);
    }
  });

  it('lets the Bot role read and answer in #musica', () => {
    const music = botsOn('music')!;
    expect(music.deny & P.ViewChannel).toBe(0n);
    expect(music.allow & (P.ViewChannel | P.SendMessages)).toBe(P.ViewChannel | P.SendMessages);
  });

  it("lets the Bot role use every voice channel's chat, generators included (rooms copy them)", () => {
    const voice = desired.channels.filter((c) => c.kind === 'voice');
    expect(voice.length).toBeGreaterThan(0);
    for (const channel of voice) {
      const bots = channel.overwrites.find((o) => o.target === 'bots');
      const wanted = P.ViewChannel | P.Connect | P.SendMessages | P.ReadMessageHistory;
      expect((bots?.allow ?? 0n) & wanted, channel.key).toBe(wanted);
    }
  });
});

describe('Aliado, Restrito and the alliances', () => {
  const on = (state: typeof desired, channelKey: string, role: string) =>
    state.channels.find((c) => c.key === channelKey)!.overwrites.find((o) => o.target === role);

  it('gives Aliado what Soldado gets, even where Parceiro is left out', () => {
    for (const key of ['general', 'builds', 'agenda', 'alliance-chat', 'alliance-voice']) {
      expect(on(desired, key, 'ally')?.allow ?? 0n, key).not.toBe(0n);
    }
    expect(on(desired, 'builds', 'partner')).toBeUndefined();
    expect(on(desired, 'alliance-chat', 'partner')).toBeUndefined();
    expect(on(desired, 'officers', 'ally')).toBeUndefined();
  });

  it('lets Restrito into #geral only', () => {
    expect(on(desired, 'general', 'restricted')!.allow & P.ViewChannel).toBe(P.ViewChannel);
    for (const key of ['off-topic', 'news', 'alliance-chat', 'general-voice']) {
      expect(on(desired, key, 'restricted'), key).toBeUndefined();
    }
  });

  it('puts each alliance role right above Aliado, hoisted, without permissions', () => {
    const withAlliance = buildDesiredState({
      ...config,
      alliances: [{ key: 'ally-noxus', legion: 'Noxus' }],
    });
    const keys = withAlliance.roles.map((r) => r.key);
    expect(keys.slice(keys.indexOf('soldier'), keys.indexOf('partner') + 1)).toEqual([
      'soldier',
      'ally-leader',
      'ally-noxus',
      'ally',
      'partner',
    ]);
    expect(withAlliance.roles.find((r) => r.key === 'ally-noxus')).toMatchObject({
      name: 'Noxus',
      hoist: true,
      permissions: 0n,
    });
  });
});
