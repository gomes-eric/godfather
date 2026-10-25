import { describe, expect, it } from 'vitest';
import { PendingConfirmations } from './confirm.js';

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('PendingConfirmations', () => {
  it('hands the payload back once to the same user', () => {
    const store = new PendingConfirmations<string>(1000);
    const id = store.create('u1', 'ban @Fulano');

    expect(store.take(id, 'u1')).toBe('ban @Fulano');
    expect(store.take(id, 'u1')).toBeUndefined();
  });

  it('refuses another user without consuming the entry', () => {
    const store = new PendingConfirmations<string>(1000);
    const id = store.create('u1', 'ban @Fulano');

    expect(store.take(id, 'u2')).toBeUndefined();
    expect(store.take(id, 'u1')).toBe('ban @Fulano');
  });

  it('expires after the TTL', () => {
    const time = clock();
    const store = new PendingConfirmations<string>(1000, time.now);
    const id = store.create('u1', 'ban @Fulano');

    time.advance(1000);
    expect(store.take(id, 'u1')).toBeUndefined();
  });

  it('cancels only for the owner', () => {
    const store = new PendingConfirmations<string>(1000);
    const id = store.create('u1', 'ban @Fulano');

    expect(store.cancel(id, 'u2')).toBe(false);
    expect(store.cancel(id, 'u1')).toBe(true);
    expect(store.take(id, 'u1')).toBeUndefined();
  });

  it('prunes expired entries when new ones are created', () => {
    const time = clock();
    const store = new PendingConfirmations<string>(1000, time.now);
    store.create('u1', 'a');
    store.create('u1', 'b');

    time.advance(1500);
    store.create('u1', 'c');
    expect(store.size).toBe(1);
  });
});
