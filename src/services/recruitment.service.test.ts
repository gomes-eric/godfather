import { describe, expect, it } from 'vitest';
import type { ConfigStore } from '../config/store.js';
import type { ActionRunner } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { ApplicationStore } from '../db/applications.js';
import { openDatabase } from '../db/client.js';
import { RecruitmentService } from './recruitment.service.js';

const actor = (userId: string, tier: Actor['tier'] = 'visitor'): Actor => ({
  userId,
  tier,
  source: 'slash',
});
const character = {
  id: 'c1',
  name: 'Padrinho',
  serverId: 2403,
  className: 'Clérigo',
  level: 45,
  combatPower: 100000,
  itemLevel: 2000,
  legion: '',
  title: null,
  avatarUrl: null,
};

function setup() {
  const db = openDatabase(':memory:');
  const store = new ApplicationStore(db.db);
  const service = new RecruitmentService({
    config: {
      get: () => ({ roles: [{ key: 'class-cleric', name: 'Clérigo', class: true, emoji: '✨' }] }),
    } as unknown as ConfigStore,
    store,
    runAction: (async (r: { execute: () => Promise<unknown> }) => ({
      status: 'ok',
      value: await r.execute(),
    })) as unknown as ActionRunner,
  });
  return { service, store };
}

describe('RecruitmentService', () => {
  it('takes one application per Visitante and refuses legion members', async () => {
    const { service } = setup();
    const input = { character, reason: 'Quero jogar Abismo', schedule: 'Noites' };

    const first = await service.apply(actor('u1'), input);
    expect(first).toMatchObject({
      status: 'ok',
      value: { characterName: 'Padrinho', status: 'pending' },
    });
    expect(await service.apply(actor('u1'), input)).toMatchObject({ status: 'rejected' });
    expect(await service.apply(actor('u2', 'soldier'), input)).toMatchObject({
      status: 'rejected',
    });
  });

  it('records who decided, once', async () => {
    const { service } = setup();
    const created = await service.apply(actor('u1'), { character, reason: 'r', schedule: 's' });
    if (created.status !== 'ok') throw new Error('not created');

    expect(await service.decide(actor('officer', 'officer'), created.value.id, true)).toMatchObject(
      {
        status: 'ok',
        value: { status: 'approved', decidedBy: 'officer' },
      },
    );
    expect(
      await service.decide(actor('officer', 'officer'), created.value.id, false),
    ).toMatchObject({
      status: 'rejected',
      reason: 'Essa ficha já foi decidida.',
    });
  });

  it('finds the class role from the game class name', () => {
    expect(setup().service.classRole('CLERIGO')?.key).toBe('class-cleric');
  });
});
