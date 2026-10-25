import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit.js';

describe('RateLimiter', () => {
  it('allows up to the limit in the window, then frees slots as they age out', () => {
    let now = 0;
    const limiter = new RateLimiter(30, 60_000, () => now);

    const first = Array.from({ length: 31 }, () => limiter.take('guild'));
    expect(first.filter(Boolean)).toHaveLength(30);
    expect(first.at(-1)).toBe(false);

    now = 60_000;
    expect(limiter.take('guild')).toBe(true);
  });

  it('keeps keys independent', () => {
    const limiter = new RateLimiter(1, 60_000, () => 0);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
    expect(limiter.take('b')).toBe(true);
  });
});
