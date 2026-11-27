import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigStore } from '../config/store.js';
import type { GuildDirectory } from '../discord/directory.js';
import type { Logger } from '../logger.js';
import { MusicGuardService, NoticeThrottle, type GuardTarget } from './music-guard.service.js';

describe('NoticeThrottle', () => {
  it('tells each person at most once per window', () => {
    let now = 0;
    const throttle = new NoticeThrottle(10 * 60_000, () => now);

    expect(throttle.take('ana')).toBe(true);
    expect(throttle.take('ana')).toBe(false);
    expect(throttle.take('bia')).toBe(true);

    now = 10 * 60_000;
    expect(throttle.take('ana')).toBe(true);
  });
});

describe('MusicGuardService.remove', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const guard = () =>
    new MusicGuardService({
      directory: {} as GuildDirectory,
      config: {} as ConfigStore,
      logger: {} as Logger,
    });

  function message(authorId: string, events: string[], sendable = true): GuardTarget {
    return {
      authorId,
      delete: async () => void events.push(`delete ${authorId}`),
      notify: async (content) => {
        if (!sendable) return null;
        events.push(`notice ${content}`);
        return { delete: async () => events.push(`notice gone ${content}`) };
      },
    };
  }

  it('removes the message and leaves a notice that deletes itself after 10s', async () => {
    const events: string[] = [];
    await guard().remove(message('ana', events), 'só comandos');
    expect(events).toEqual(['delete ana', 'notice só comandos']);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(events).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(events.at(-1)).toBe('notice gone só comandos');
  });

  it('tells each person once per 10 minutes, but always removes the message', async () => {
    const events: string[] = [];
    const service = guard();
    await service.remove(message('ana', events), 'um');
    await service.remove(message('ana', events), 'dois');
    await service.remove(message('bia', events), 'três');
    expect(events.filter((e) => e.startsWith('delete'))).toHaveLength(3);
    expect(events.filter((e) => e.startsWith('notice '))).toEqual(['notice um', 'notice três']);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await service.remove(message('ana', events), 'quatro');
    expect(events.at(-1)).toBe('notice quatro');
  });

  it('only removes the message where it cannot post a notice', async () => {
    const events: string[] = [];
    await guard().remove(message('ana', events, false), 'só comandos');
    expect(events).toEqual(['delete ana']);
  });
});
