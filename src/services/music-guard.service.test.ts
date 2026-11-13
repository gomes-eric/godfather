import { describe, expect, it } from 'vitest';
import { isMusicCommand, keepInMusicChannel, NoticeThrottle } from './music-guard.service.js';

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

describe('isMusicCommand', () => {
  const jockie = new Set(['411916947773587456']);

  it('takes the prefixes and a music bot mention at the start as commands', () => {
    for (const content of ['m!p never gonna', '  M!skip', '<@411916947773587456> play x']) {
      expect(isMusicCommand(content, ['m!'], jockie), content).toBe(true);
    }
    expect(isMusicCommand('<@!411916947773587456> p x', ['m!'], jockie)).toBe(true);
  });

  it('leaves ordinary chat alone, including mentions of people', () => {
    for (const content of ['bora tocar m!p depois?', 'oi <@411916947773587456>', '<@1> olha']) {
      expect(isMusicCommand(content, ['m!'], jockie), content).toBe(false);
    }
  });
});
