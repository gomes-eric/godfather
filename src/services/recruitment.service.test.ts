import { describe, expect, it } from 'vitest';
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

const form = {
  picked: 'member',
  kind: 'member',
  character,
  allianceLegion: null,
  duplicateOf: null,
} as const;

function setup() {
  const db = openDatabase(':memory:');
  const store = new ApplicationStore(db.db);
  const service = new RecruitmentService({
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

    const first = await service.apply(actor('u1'), form);
    expect(first).toMatchObject({
      status: 'ok',
      value: { characterName: 'Padrinho', kind: 'member', origin: 'form', status: 'pending' },
    });
    expect(await service.apply(actor('u1'), form)).toMatchObject({ status: 'rejected' });
    expect(await service.apply(actor('u2', 'soldier'), form)).toMatchObject({
      status: 'rejected',
    });
  });

  it('records who decided, once', async () => {
    const { service } = setup();
    const created = await service.apply(actor('u1'), form);
    if (created.status !== 'ok') throw new Error('not created');

    expect(
      await service.decide(actor('officer', 'officer'), created.value.id, true, async () => {}),
    ).toMatchObject({
      status: 'ok',
      value: { status: 'approved', decidedBy: 'officer' },
    });
    expect(
      await service.decide(actor('officer', 'officer'), created.value.id, false, async () => {}),
    ).toMatchObject({
      status: 'rejected',
      reason: 'Essa ficha já foi decidida.',
    });
  });

  it('Mudar changes the type while pending only', async () => {
    const { service } = setup();
    const created = await service.apply(actor('u1'), form);
    if (created.status !== 'ok') throw new Error('not created');
    const officer = actor('officer', 'officer');

    expect(await service.changeKind(officer, created.value.id, 'ally', 'Noxus')).toMatchObject({
      status: 'ok',
      value: { kind: 'ally', requestedKind: 'member', allianceLegion: 'Noxus' },
    });
    await service.decide(officer, created.value.id, true, async () => {});
    expect(await service.changeKind(officer, created.value.id, 'partner', null)).toMatchObject({
      status: 'rejected',
    });
  });
});
