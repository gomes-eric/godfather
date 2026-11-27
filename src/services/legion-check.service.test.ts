import { describe, expect, it } from 'vitest';
import type { Logger } from '../logger.js';
import type { GameCharacterService } from './game-character.service.js';
import { LegionCheckService } from './legion-check.service.js';
import type { RankingBoard } from './ranking-board.service.js';
import type { ReviewRequest } from './recruitment.service.js';
import {
  passThroughRunner,
  profile,
  registrationFixture,
  roleId,
} from './testing/roster-fixture.js';

const logger = { info: () => undefined, warn: () => undefined } as unknown as Logger;

function setup(
  now: { name: string; className: string; legion: string },
  options: { registered?: string[]; standingRole?: string } = {},
) {
  const f = registrationFixture();
  f.config.addAlliance({ key: 'ally-noxus', legion: 'Noxus' });
  for (const userId of options.registered ?? ['u1']) {
    f.members.add({
      id: userId,
      displayName: '✨ Padrinho',
      roleIds: [roleId(options.standingRole ?? 'soldier'), roleId('class-cleric')],
    });
    f.registrations.save({
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
  const reviews: ReviewRequest[] = [];
  let rankingRefreshes = 0;
  const service = new LegionCheckService({
    config: f.config,
    directory: f.directory,
    ranking: { refresh: async () => void rankingRefreshes++ } as unknown as RankingBoard,
    registrations: f.registrations,
    characters: {
      profile: async () => ({ ...profile(now.name, now.legion, now.className), combatPower: 150 }),
    } as unknown as GameCharacterService,
    roster: f.roster,
    restrictions: f.restrictions,
    review: async (request) => void reviews.push(request),
    botUserId: 'padrinho',
    runAction: passThroughRunner,
    logger,
    pause: async () => undefined,
  });
  return { ...f, service, reviews, rankings: () => rankingRefreshes };
}

describe('LegionCheckService', () => {
  it('syncs a new class and name, restricts a Soldado who left and opens a review', async () => {
    const s = setup({ name: 'Padrinho2', className: 'Mago', legion: 'Outra' });
    const report = await s.service.check();

    expect(report).toHaveLength(3);
    expect(report.join('\n')).toContain('**Padrinho** → **Padrinho2**');
    expect(report.join('\n')).toContain('**Clérigo** → **Mago**');
    expect(report.join('\n')).toContain('virou **Restrito**');
    expect(s.members.roles('u1')).toEqual([roleId('class-sorcerer'), roleId('restricted')]);
    expect(s.members.nickname('u1')).toBe('🔥 Padrinho2');
    expect(s.restrictions.get('u1')?.origin).toBe('check');
    expect(s.reviews).toEqual([
      expect.objectContaining({
        userId: 'u1',
        kind: 'restricted',
        previous: { kind: 'tier', tier: 'soldier' },
      }),
    ]);
    expect(s.sent.map((m) => m.channel)).toEqual(['officers']);
    expect(s.registrations.get('u1')).toMatchObject({
      name: 'Padrinho2',
      classKey: 'class-sorcerer',
      legion: 'Outra',
      combatPower: 150,
    });
    expect(s.rankings()).toBe(1);
  });

  it('makes a Soldado who moved to an allied legion an Aliado of it', async () => {
    const s = setup({ name: 'Padrinho', className: 'Clérigo', legion: 'Noxus' });
    await s.service.check();
    expect(s.members.roles('u1')).toEqual([
      roleId('class-cleric'),
      roleId('ally'),
      roleId('ally-noxus'),
    ]);
    expect(s.reviews).toEqual([expect.objectContaining({ kind: 'ally', allianceLegion: 'Noxus' })]);
  });

  it('only reports an Oficial who left, with a review', async () => {
    const s = setup(
      { name: 'Padrinho', className: 'Clérigo', legion: 'Outra' },
      { standingRole: 'officer' },
    );
    const report = await s.service.check();
    expect(s.members.roles('u1')).toContain(roleId('officer'));
    expect(report.join('\n')).toContain('O cargo não muda sozinho');
    expect(s.reviews).toEqual([
      expect.objectContaining({ previous: { kind: 'tier', tier: 'officer' } }),
    ]);
  });

  it('moves nobody when more than 3 seem to leave at once, and checks them again next time', async () => {
    const s = setup(
      { name: 'Padrinho', className: 'Clérigo', legion: '' },
      { registered: ['u1', 'u2', 'u3', 'u4'] },
    );
    const report = await s.service.check();
    expect(s.members.writes).toEqual([]);
    expect(s.reviews).toEqual([]);
    expect(report.join('\n')).toContain('ninguém mudou de cargo');
    expect(s.registrations.get('u1')?.legion).toBe('M4F1A');
  });

  it('gives Soldado back to someone the check restricted who returned, not to an officer restriction', async () => {
    const back = setup(
      { name: 'Padrinho', className: 'Clérigo', legion: 'M4F1A' },
      { standingRole: 'restricted' },
    );
    back.restrictions.set({ userId: 'u1', origin: 'check', reason: null, by: 'padrinho' });
    await back.service.check();
    expect(back.members.roles('u1')).toContain(roleId('soldier'));

    const held = setup(
      { name: 'Padrinho', className: 'Clérigo', legion: 'M4F1A' },
      { standingRole: 'restricted' },
    );
    held.restrictions.set({ userId: 'u1', origin: 'officer', reason: 'spam', by: 'officer' });
    await held.service.check();
    expect(held.members.writes).toEqual([]);
  });

  it('stays quiet when nothing changed, and is not due again right away', async () => {
    const s = setup({ name: 'Padrinho', className: 'Clérigo', legion: 'M4F1A' });
    expect(await s.service.check()).toEqual([]);
    expect(s.members.writes).toEqual([]);
    expect(await s.service.runIfDue()).toEqual([]);
  });

  it('runs now on request and reports how many characters it read', async () => {
    const s = setup({ name: 'Padrinho', className: 'Clérigo', legion: 'M4F1A' });
    const officer = { userId: 'officer', tier: 'officer', source: 'slash' } as const;
    expect(await s.service.runNow(officer)).toEqual({
      status: 'ok',
      value: { report: [], members: 1 },
    });
  });
});
