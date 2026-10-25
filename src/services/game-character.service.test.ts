import { describe, expect, it } from 'vitest';
import type { ConfigStore } from '../config/store.js';
import type { Logger } from '../logger.js';
import { GameApiError, GameCharacterService } from './game-character.service.js';

const config = {
  get: () => ({ settings: { characters: { region: 'la', serverId: 2403, legion: 'M4F1A' } } }),
} as unknown as ConfigStore;
const logger = { warn: () => undefined } as unknown as Logger;

const info = {
  profile: {
    characterId: 'AbC+d=',
    characterName: 'Padrinho',
    characterLevel: 45,
    className: 'Clérigo',
    serverId: 2403,
    regionName: 'M4F1A',
  },
};

describe('GameCharacterService', () => {
  it('searches the configured server and encodes the character id', async () => {
    const urls: string[] = [];
    const service = new GameCharacterService({
      config,
      logger,
      fetchJson: async (url) => {
        urls.push(url);
        return url.includes('search')
          ? { list: [{ characterId: 'AbC%2Bd%3D', name: 'Padrinho', serverId: 2403 }] }
          : info;
      },
    });

    const ref = await service.find('Padrinho');
    expect(ref).toEqual({ id: 'AbC+d=', name: 'Padrinho', serverId: 2403 });
    expect((await service.profile(ref!)).legion).toBe('M4F1A');
    expect(urls[0]).toContain('serverId=2403');
    expect(urls[0]).toContain('region=la');
    expect(urls[1]).toContain('characterId=AbC%2Bd%3D');
  });

  it('caches responses for half an hour unless asked for fresh data', async () => {
    let now = 0;
    let calls = 0;
    const service = new GameCharacterService({
      config,
      logger,
      now: () => now,
      fetchJson: async () => {
        calls++;
        return info;
      },
    });
    const ref = { id: 'AbC+d=', serverId: 2403 };

    await service.profile(ref);
    await service.profile(ref);
    expect(calls).toBe(1);
    await service.profile(ref, true);
    expect(calls).toBe(2);
    now = 31 * 60_000;
    await service.profile(ref);
    expect(calls).toBe(3);
  });

  it('turns network failures and odd responses into GameApiError', async () => {
    const failing = new GameCharacterService({
      config,
      logger,
      fetchJson: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(failing.find('Padrinho')).rejects.toBeInstanceOf(GameApiError);

    const odd = new GameCharacterService({ config, logger, fetchJson: async () => ({}) });
    await expect(odd.profile({ id: 'x', serverId: 2403 })).rejects.toBeInstanceOf(GameApiError);
  });
});
