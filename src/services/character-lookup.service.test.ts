import { describe, expect, it } from 'vitest';
import { createActionRunner } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { CharacterStore } from '../db/characters.js';
import { openDatabase } from '../db/client.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import { CharacterLookup } from './character-lookup.service.js';
import type { FetchJson } from './fetch-json.js';
import { GameCharacterService } from './game-character.service.js';
import { testConfig } from './testing/roster-fixture.js';

const config = testConfig();
const logger = { warn: () => undefined } as unknown as Logger;
const t = ptBR.profile;

const actor: Actor = { userId: 'u-self', tier: 'visitor', source: 'slash' };
const profile = (characterId: string) => ({
  profile: {
    characterId,
    characterName: 'Padrinho',
    characterLevel: 45,
    className: 'Clérigo',
    serverId: 2403,
    regionName: 'M4F1A',
  },
});
const equipment = {
  equipment: {
    equipmentList: [
      { id: 110730048, slotPos: 1, slotPosName: 'MainHand', name: 'Maça', enchantLevel: 10 },
    ],
  },
};

function setup(site: 'up' | 'down' = 'up') {
  const db = openDatabase(':memory:');
  const registrations = new CharacterStore(db.db);
  for (const userId of ['u-self', 'u-member']) {
    registrations.save({
      userId,
      characterId: `c-${userId}`,
      serverId: 2403,
      name: 'Padrinho',
      classKey: 'class-cleric',
      legion: 'M4F1A',
      combatPower: 100,
      itemLevel: 2000,
    });
  }
  const urls: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    urls.push(url);
    if (site === 'down') throw new TypeError('fetch failed');
    if (url.includes('/search/')) {
      return { list: [{ characterId: 'c-by-name', name: '<b>Padrinho</b>', serverId: 2403 }] };
    }
    if (url.includes('/equipment/item')) return { name: 'Maça', enchantLevel: 10 };
    if (url.includes('/equipment')) return equipment;
    return profile(new URL(url).searchParams.get('characterId') ?? '');
  };
  const lookup = new CharacterLookup({
    characters: new GameCharacterService({ config, logger, fetchJson }),
    registrations,
    config,
    memberName: (userId) => (userId === 'u-member' ? 'Padrinho Discord' : undefined),
    runAction: createActionRunner({ record: async () => Promise.reject(new Error('audited')) }),
  });
  return { lookup, registrations, urls };
}

describe('CharacterLookup', () => {
  it('finds a character by name on the official site', async () => {
    const { lookup, urls } = setup();
    const outcome = await lookup.sheetFor(actor, { name: 'Padrinho' });

    expect(outcome).toMatchObject({
      status: 'ok',
      value: {
        profile: { id: 'c-by-name', name: 'Padrinho', legion: 'M4F1A' },
        equipment: [{ name: 'Maça', slot: 'MainHand', enchantLevel: 10 }],
      },
    });
    expect(urls[0]).toContain('keyword=Padrinho');
  });

  it("reads a member's registered character, or the actor's own, without searching", async () => {
    const { lookup, urls } = setup();

    const member = await lookup.sheetFor(actor, { userId: 'u-member' });
    expect(member).toMatchObject({ status: 'ok', value: { profile: { id: 'c-u-member' } } });
    const own = await lookup.sheetFor(actor, { userId: actor.userId });
    expect(own).toMatchObject({ status: 'ok', value: { profile: { id: 'c-u-self' } } });
    expect(urls.some((url) => url.includes('/search/'))).toBe(false);
  });

  it('tells apart the actor and another member having no registered character', async () => {
    const { lookup, registrations } = setup();
    registrations.delete('u-self');
    registrations.delete('u-member');

    expect(await lookup.sheetFor(actor, { userId: actor.userId })).toEqual({
      status: 'rejected',
      reason: t.notRegistered,
    });
    expect(await lookup.sheetFor(actor, { userId: 'u-member' })).toEqual({
      status: 'rejected',
      reason: t.memberNotRegistered('u-member'),
    });
  });

  it('says when no character has that name', async () => {
    const { lookup } = setup();
    expect(await lookup.sheetFor(actor, { name: 'Ninguém' })).toEqual({
      status: 'rejected',
      reason: t.notFound('Ninguém'),
    });
  });

  it('says when the official site is down', async () => {
    const { lookup } = setup('down');
    const down = { status: 'rejected', reason: t.apiDown };

    expect(await lookup.sheetFor(actor, { name: 'Padrinho' })).toEqual(down);
    expect(await lookup.sheetFor(actor, { userId: 'u-member' })).toEqual(down);
    expect(
      await lookup.gearDetail(
        actor,
        { id: 'c-u-member', serverId: 2403 },
        { id: 110730048, slotPos: 1, enchantLevel: 10 },
      ),
    ).toEqual(down);
  });

  it('details a piece of gear with the name of who wears it', async () => {
    const { lookup } = setup();
    const outcome = await lookup.gearDetail(
      actor,
      { id: 'c-u-member', serverId: 2403 },
      { id: 110730048, slotPos: 1, enchantLevel: 10 },
    );
    expect(outcome).toMatchObject({
      status: 'ok',
      value: { item: { name: 'Maça', enchantLevel: 10 }, characterName: 'Padrinho' },
    });
  });

  it('lists the registered characters with their class, legion and Discord name', async () => {
    const { lookup } = setup();
    const outcome = await lookup.registered({ ...actor, tier: 'officer' });
    expect(outcome).toMatchObject({
      status: 'ok',
      value: expect.arrayContaining([
        expect.objectContaining({
          userId: 'u-member',
          member: 'Padrinho Discord',
          class: 'Clérigo',
          inLegion: true,
        }),
        expect.objectContaining({ userId: 'u-self', member: null }),
      ]),
    });
  });
});
