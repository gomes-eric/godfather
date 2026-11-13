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
