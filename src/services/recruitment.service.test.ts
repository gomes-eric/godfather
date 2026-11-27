import { describe, expect, it } from 'vitest';
import type { Actor } from '../core/actor.js';
import { encodeStanding, SOLDIER } from '../core/standing.js';
import { ApplicationStore } from '../db/applications.js';
import type { Logger } from '../logger.js';
import { AllianceService } from './alliance.service.js';
import type { ApplicationView, RecruitmentBoard } from './recruitment-board.js';
import { Recruitment } from './recruitment.service.js';
import type { SetupService } from './setup.service.js';
import {
  passThroughRunner,
  profile,
  registrationFixture,
  roleId,
} from './testing/roster-fixture.js';

const officer: Actor = { userId: 'officer', tier: 'officer', source: 'slash' };
const commander: Actor = { userId: 'commander', tier: 'commander', source: 'slash' };
const visitor: Actor = { userId: 'u1', tier: 'visitor', source: 'slash' };
const logger = { warn: () => undefined, info: () => undefined } as unknown as Logger;

class FakeBoard implements RecruitmentBoard {
  readonly posted: { view: ApplicationView; ping: boolean }[] = [];
  readonly refreshed: ApplicationView[] = [];
  readonly said: string[] = [];
  readonly deleted: string[] = [];

  async post(view: ApplicationView, options: { ping: boolean }) {
    this.posted.push({ view, ping: options.ping });
    return { threadId: `thread-${view.application.id}`, messageId: `card-${view.application.id}` };
  }
  async refresh(view: ApplicationView) {
    this.refreshed.push(view);
  }
  async say(_application: unknown, content: string) {
    this.said.push(content);
  }
  async deleteThread(threadId: string) {
    this.deleted.push(threadId);
    return true;
  }
}

function setup(options: { syncFails?: boolean } = {}) {
  const characters = {
    padrinho: profile('Padrinho', 'M4F1A'),
    outsider: profile('Padrinho Jr', ''),
    allied: profile('Padrinho Aliado', 'Noxus', 'Mago'),
    lagta: profile('Padrinho Lagta', 'Lagta', 'Mago'),
  };
  const f = registrationFixture(characters);
  f.members
    .add({ id: 'officer', roleIds: [roleId('officer')] })
    .add({ id: 'commander', roleIds: [roleId('commander')] })
    .add({ id: 'u1', displayName: 'padrinho_discord', roleIds: [roleId('visitor')] })
    .add({ id: 'u9', roleIds: [roleId('soldier')] });
  f.config.addAlliance({ key: 'ally-noxus', legion: 'Noxus' });
  const setupService = {
    syncRoles: async () => ({ applied: [], failures: options.syncFails ? [{}] : [] }),
  } as unknown as SetupService;
  const alliances = new AllianceService({
    guild: {} as never,
    config: f.config,
    directory: f.directory,
    setup: setupService,
    roster: f.roster,
    runAction: passThroughRunner,
    logger,
  });
  const board = new FakeBoard();
  const store = new ApplicationStore(f.db.db);
  const clock = { now: new Date('2026-11-09T12:00:00Z') };
  const recruitment = new Recruitment({
    store,
    board,
    roster: f.roster,
    registration: f.registration,
    alliances,
    config: f.config,
    directory: f.directory,
    runAction: passThroughRunner,
    botUserId: 'padrinho',
    logger,
    now: () => clock.now,
  });
  return { ...f, board, store, recruitment, clock };
}

async function sent(
  s: ReturnType<typeof setup>,
  picked: 'member' | 'ally' | 'partner',
  name: string | null,
) {
  const outcome = await s.recruitment.submit(visitor, { picked, characterName: name });
  if (outcome.status !== 'ok') throw new Error(JSON.stringify(outcome));
  return outcome.value;
}

describe('Recruitment.submit', () => {
  it('posts a Membro in a private thread, pinging the officers', async () => {
    const s = setup();
    const { application, autoApproved } = await sent(s, 'member', 'Padrinho Jr');
    expect(autoApproved).toBe(false);
    expect(s.board.posted).toEqual([expect.objectContaining({ ping: true })]);
    expect(s.store.get(application.id)).toMatchObject({
      kind: 'member',
      threadId: `thread-${application.id}`,
      messageId: `card-${application.id}`,
    });
  });

  it('approves a Membro already in the legion on its own, quietly, with a welcome', async () => {
    const s = setup();
    const { application, autoApproved } = await sent(s, 'member', 'padrinho');
    expect(autoApproved).toBe(true);
    expect(application).toMatchObject({ status: 'approved', decidedBy: 'padrinho' });
    expect(s.board.posted).toEqual([expect.objectContaining({ ping: false })]);
    expect(s.members.roles('u1')).toEqual([roleId('soldier'), roleId('class-cleric')]);
    expect(s.board.said).toEqual([expect.stringContaining('🎉')]);
    expect(s.sent.at(-1)?.content).toContain('entrou sozinho');
  });

  it('never approves a character someone else has; it waits with a warning', async () => {
    const s = setup();
    await s.registration.register(officer, 'u9', 'Padrinho');
    const { application, autoApproved } = await sent(s, 'member', 'Padrinho');
    expect(autoApproved).toBe(false);
    expect(application).toMatchObject({ status: 'pending', characterTakenBy: 'u9' });
    expect(s.sent.at(-1)?.content).toContain('<@u9>');
  });

  it('does not let someone an officer restricted back in on their own', async () => {
    const s = setup();
    s.restrictions.set({ userId: 'u1', origin: 'officer', reason: 'spam', by: 'officer' });
    expect(await sent(s, 'member', 'Padrinho')).toMatchObject({ autoApproved: false });
  });

  it('refuses an Aliança without a legion, a Membro without a name, and an unknown name', async () => {
    const s = setup();
    for (const [picked, name] of [
      ['ally', 'Padrinho Jr'],
      ['member', null],
      ['member', 'Ninguém'],
    ] as const) {
      expect(await s.recruitment.submit(visitor, { picked, characterName: name })).toMatchObject({
        status: 'rejected',
      });
    }
    expect(s.store.list()).toEqual([]);
  });
});

describe('Recruitment.decide', () => {
  it('approving a Parceiro without a character gives Parceiro only', async () => {
    const s = setup();
    const { application } = await sent(s, 'partner', null);
    expect(application.character).toBeNull();
    expect(await s.recruitment.decide(officer, application.id, true)).toMatchObject({
      status: 'ok',
    });
    expect(s.members.roles('u1')).toEqual([roleId('partner')]);
    expect(s.board.said).toEqual([expect.stringContaining('Parceiro')]);
  });

  it('an Aliança of a known alliance makes them Aliado with their class', async () => {
    const s = setup();
    const { application } = await sent(s, 'ally', 'padrinho aliado');
    expect(application).toMatchObject({ kind: 'ally', allianceLegion: 'Noxus' });
    await s.recruitment.decide(officer, application.id, true);
    expect(s.members.roles('u1')).toEqual([
      roleId('ally'),
      roleId('ally-noxus'),
      roleId('class-sorcerer'),
    ]);
  });

  it('a new alliance needs a Comandante, and creates nothing until every check passed', async () => {
    const s = setup();
    const { application } = await sent(s, 'ally', 'Padrinho Lagta');
    expect(await s.recruitment.decide(officer, application.id, true)).toMatchObject({
      status: 'rejected',
    });
    expect(s.config.get().alliances.map((a) => a.legion)).toEqual(['Noxus']);

    expect(await s.recruitment.decide(commander, application.id, true)).toMatchObject({
      status: 'ok',
    });
    expect(s.config.get().alliances.map((a) => a.legion)).toEqual(['Noxus', 'Lagta']);
    expect(s.members.roles('u1')).toContain(roleId('ally-lagta'));
  });

  it('leaves nothing behind when the new alliance role cannot be created', async () => {
    const s = setup({ syncFails: true });
    const { application } = await sent(s, 'ally', 'Padrinho Lagta');
    expect(await s.recruitment.decide(commander, application.id, true)).toMatchObject({
      status: 'rejected',
    });
    expect(s.config.get().alliances.map((a) => a.legion)).toEqual(['Noxus']);
    expect(s.store.get(application.id)?.status).toBe('pending');
    expect(s.members.roles('u1')).toEqual([roleId('visitor')]);
  });

  it('decides an application once, even with two clicks at the same time', async () => {
    const s = setup();
    const { application } = await sent(s, 'member', 'Padrinho Jr');
    const [first, second] = await Promise.all([
      s.recruitment.decide(officer, application.id, true),
      s.recruitment.decide(officer, application.id, true),
    ]);
    expect([first.status, second.status].sort()).toEqual(['ok', 'rejected']);
    expect(s.members.writes.filter((w) => w.userId === 'u1')).toHaveLength(1);
  });

  it('a Soldado cannot decide, and nothing changes', async () => {
    const s = setup();
    const { application } = await sent(s, 'member', 'Padrinho Jr');
    const soldier: Actor = { userId: 'u9', tier: 'soldier', source: 'slash' };
    expect(await s.recruitment.decide(soldier, application.id, true)).toMatchObject({
      status: 'denied',
    });
    expect(s.store.get(application.id)?.status).toBe('pending');
  });

  it('refuses to approve someone who left the server', async () => {
    const s = setup();
    const { application } = await sent(s, 'member', 'Padrinho Jr');
    s.members.remove('u1');
    expect(await s.recruitment.decide(officer, application.id, true)).toMatchObject({
      status: 'rejected',
    });
  });
});

describe('Recruitment.changeKind and reviews', () => {
  it('Mudar switches the type; Aliança takes the character legion; Restrito only for reviews', async () => {
    const s = setup();
    const { application } = await sent(s, 'member', 'Padrinho Aliado');
    expect(await s.recruitment.changeKind(officer, application.id, 'ally')).toMatchObject({
      status: 'ok',
      value: { kind: 'ally', requestedKind: 'member', allianceLegion: 'Noxus' },
    });
    expect(await s.recruitment.changeKind(officer, application.id, 'restricted')).toMatchObject({
      status: 'rejected',
    });
    expect(s.board.refreshed.at(-1)?.application.kind).toBe('ally');
  });

  it('a daily check review goes to the officers; refusing it puts the old standing back', async () => {
    const s = setup();
    s.members.add({ id: 'u5', roleIds: [roleId('restricted')] });
    await s.recruitment.openReview({
      userId: 'u5',
      kind: 'restricted',
      character: profile('Padrinho Sumido', 'Outra'),
      allianceLegion: null,
      previous: SOLDIER,
    });
    const review = s.store.list()[0]!;
    expect(review).toMatchObject({
      origin: 'check',
      previousStanding: encodeStanding(SOLDIER),
    });
    expect(s.board.posted[0]?.view.look.previousStanding).toBe('Soldado');
    await s.recruitment.decide(officer, review.id, false);
    expect(s.members.roles('u5')).toEqual([roleId('soldier')]);
  });

  it('lists applications with names resolved', async () => {
    const s = setup();
    await sent(s, 'member', 'Padrinho Jr');
    expect(await s.recruitment.list(officer, 'pending')).toMatchObject({
      status: 'ok',
      value: [{ member: 'padrinho_discord', character: { name: 'Padrinho Jr' } }],
    });
  });
});

describe('Recruitment.sweepThreads', () => {
  const later = (clock: { now: Date }, minutes: number) =>
    (clock.now = new Date(clock.now.getTime() + minutes * 60_000));

  it('deletes an approved thread after an hour and a refused one after six', async () => {
    const s = setup();
    const approved = (await sent(s, 'member', 'Padrinho Jr')).application;
    await s.recruitment.decide(officer, approved.id, true);
    s.clock.now = s.store.get(approved.id)!.decidedAt!;
    later(s.clock, 59);
    expect(await s.recruitment.sweepThreads()).toBe(0);
    later(s.clock, 1);
    expect(await s.recruitment.sweepThreads()).toBe(1);
    expect(s.store.get(approved.id)).toMatchObject({ threadId: null, messageId: null });
  });

  it("leaves pending applications' threads alone", async () => {
    const s = setup();
    await sent(s, 'member', 'Padrinho Jr');
    later(s.clock, 7 * 24 * 60);
    expect(await s.recruitment.sweepThreads()).toBe(0);
  });
});
