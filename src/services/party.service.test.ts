import { describe, expect, it } from 'vitest';
import { createActionRunner } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { openDatabase } from '../db/client.js';
import { PartyStore } from '../db/parties.js';
import { PartyService } from './party.service.js';

const actor = (userId: string, tier: Actor['tier'] = 'soldier'): Actor => ({
  userId,
  tier,
  source: 'slash',
});

function setup() {
  const db = openDatabase(':memory:');
  return new PartyService({
    store: new PartyStore(db.db),
    runAction: createActionRunner({ record: async () => Promise.reject(new Error('audited')) }),
    classEmoji: (userId) => (userId === 'leader' ? '✨' : undefined),
  });
}

async function created(service: PartyService, slots = 3) {
  const outcome = await service.create(actor('leader'), {
    channelId: 'c',
    activity: 'Caverna de Krao',
    slots,
    startsAt: '21h',
  });
  if (outcome.status !== 'ok') throw new Error('not created');
  return outcome.value;
}

describe('PartyService', () => {
  it('starts with the leader, fills up and calls everyone when the last slot is taken', async () => {
    const service = setup();
    const party = await created(service);

    expect(party.members).toEqual([{ id: 'leader', emoji: '✨' }]);
    const second = await service.act(actor('a'), party.id, 'join');
    expect(second).toMatchObject({ status: 'ok', value: { view: { id: party.id } } });
    expect(second.status === 'ok' && second.value.filled).toBeUndefined();
    const third = await service.act(actor('b'), party.id, 'join');
    expect(third.status === 'ok' && third.value.view.members.at(-1)).toEqual({
      id: 'b',
      emoji: '🎮',
    });
    expect(third.status === 'ok' && third.value.filled).toEqual({
      text: '✅ **Caverna de Krao**: grupo completo! <@leader> <@a> <@b>',
      mentionIds: ['leader', 'a', 'b'],
    });

    const fourth = await service.act(actor('c'), party.id, 'join');
    expect(fourth).toMatchObject({ status: 'rejected', reason: 'O grupo já está completo.' });
  });

  it('refuses repeats, the leader leaving, and closing by anyone but the leader or an officer', async () => {
    const service = setup();
    const party = await created(service);
    await service.act(actor('a'), party.id, 'join');

    expect((await service.act(actor('a'), party.id, 'join')).status).toBe('rejected');
    expect((await service.act(actor('leader'), party.id, 'leave')).status).toBe('rejected');
    expect(await service.act(actor('a'), party.id, 'close')).toEqual({
      status: 'denied',
      requiredTier: 'officer',
    });
    const closed = await service.act(actor('x', 'officer'), party.id, 'close');
    expect(closed.status === 'ok' && closed.value.view.closed).toBe(true);
    expect((await service.act(actor('b'), party.id, 'join')).status).toBe('rejected');
  });

  it('lets the leader close their own party', async () => {
    const service = setup();
    const party = await created(service);
    expect((await service.act(actor('leader'), party.id, 'close')).status).toBe('ok');
  });

  it('lets a member leave and frees the slot', async () => {
    const service = setup();
    const party = await created(service, 2);
    await service.act(actor('a'), party.id, 'join');
    const left = await service.act(actor('a'), party.id, 'leave');
    expect(left.status === 'ok' && left.value.view.members.map((m) => m.id)).toEqual(['leader']);
  });
});
