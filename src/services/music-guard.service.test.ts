import { describe, expect, it } from 'vitest';
import { keepInMusicChannel, NoticeThrottle } from './music-guard.service.js';

describe('keepInMusicChannel', () => {
  const person = { authorIsBot: false, system: false };

  it('keeps bot messages and system messages, removes chatter', () => {
    expect(keepInMusicChannel({ authorIsBot: true, system: false, content: 'oi' }, [])).toBe(true);
    expect(keepInMusicChannel({ authorIsBot: false, system: true, content: '' }, [])).toBe(true);
    expect(keepInMusicChannel({ ...person, content: 'que música boa' }, ['m!'])).toBe(false);
  });

  it('keeps text commands for the configured prefixes, in any case', () => {
    for (const content of ['m!p never gonna', 'm!s', '  M!Queue']) {
      expect(keepInMusicChannel({ ...person, content }, ['m!']), content).toBe(true);
    }
    expect(keepInMusicChannel({ ...person, content: 'm!p x' }, [])).toBe(false);
    expect(keepInMusicChannel({ ...person, content: 'olha m!p' }, ['m!'])).toBe(false);
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
