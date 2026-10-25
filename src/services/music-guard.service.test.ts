import { describe, expect, it } from 'vitest';
import { keepInMusicChannel, NoticeThrottle } from './music-guard.service.js';

describe('keepInMusicChannel', () => {
  it('keeps bot messages and system messages, removes what people type', () => {
    expect(keepInMusicChannel({ authorIsBot: true, system: false })).toBe(true);
    expect(keepInMusicChannel({ authorIsBot: false, system: true })).toBe(true);
    expect(keepInMusicChannel({ authorIsBot: false, system: false })).toBe(false);
  });
});

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
