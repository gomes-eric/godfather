import { describe, expect, it } from 'vitest';
import type { ActionRunner } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { openDatabase } from '../db/client.js';
import { PartyStore } from '../db/parties.js';
import type { GuildDirectory } from '../discord/directory.js';
import { PartyService } from './party.service.js';

const actor = (userId: string, tier: Actor['tier'] = 'soldier'): Actor => ({
  userId,
  tier,
  source: 'slash',
});

function setup() {
  const db = openDatabase(':memory:');
  const service = new PartyService({
    guild: { members: { cache: new Map() } } as never,
    directory: { classesOf: () => [] } as unknown as GuildDirectory,
    store: new PartyStore(db.db),
    runAction: (async (r: { execute: () => Promise<unknown> }) => ({
      status: 'ok',
      value: await r.execute(),
    })) as unknown as ActionRunner,
  });
  return service;
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
  it('starts with the leader, fills up and says when the last slot is taken', async () => {
    const service = setup();
    const party = await created(service);

    expect(service.view(party).members.map((m) => m.id)).toEqual(['leader']);
    const second = await service.act(actor('a'), party.id, 'join');
    expect(second.status === 'ok' && second.value.justFilled).toBe(false);
    const third = await service.act(actor('b'), party.id, 'join');
    expect(third.status === 'ok' && third.value.justFilled).toBe(true);

    const fourth = await service.act(actor('c'), party.id, 'join');
    expect(fourth).toMatchObject({ status: 'rejected', reason: 'O grupo já está completo.' });
  });

  it('refuses repeats, the leader leaving, and closing by anyone but the leader or an officer', async () => {
    const service = setup();
    const party = await created(service);
    await service.act(actor('a'), party.id, 'join');

    expect((await service.act(actor('a'), party.id, 'join')).status).toBe('rejected');
    expect((await service.act(actor('leader'), party.id, 'leave')).status).toBe('rejected');
    expect((await service.act(actor('a'), party.id, 'close')).status).toBe('rejected');
    expect((await service.act(actor('x', 'officer'), party.id, 'close')).status).toBe('ok');
    expect((await service.act(actor('b'), party.id, 'join')).status).toBe('rejected');
  });

  it('lets a member leave and frees the slot', async () => {
    const service = setup();
    const party = await created(service, 2);
    await service.act(actor('a'), party.id, 'join');
    await service.act(actor('a'), party.id, 'leave');
    expect(service.view(party).members.map((m) => m.id)).toEqual(['leader']);
  });
});
