import { ChannelType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { ConfigStore } from '../config/store.js';
import type { ActionRunner } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { encodeStanding, type Standing } from '../core/standing.js';
import { ApplicationStore } from '../db/applications.js';
import { openDatabase } from '../db/client.js';
import type { GuildDirectory } from '../discord/directory.js';
import type { Logger } from '../logger.js';
import type { AllianceService } from './alliance.service.js';
import type { MemberService } from './member.service.js';
import { RecruitmentDesk, type SentForm } from './recruitment-desk.service.js';
import { RecruitmentService } from './recruitment.service.js';
import type { RegistrationService } from './registration.service.js';

const officer: Actor = { userId: 'officer', tier: 'officer', source: 'mcp' };
const commander: Actor = { userId: 'commander', tier: 'commander', source: 'mcp' };
const visitor: Actor = { userId: 'u1', tier: 'visitor', source: 'slash' };
const character = (legion = '') => ({
  id: 'c1',
  name: 'Padrinho',
  serverId: 2403,
  className: 'Clérigo',
  level: 45,
  combatPower: 100_000,
  itemLevel: 2000,
  legion,
  title: null,
  avatarUrl: null,
});
const asMember = (legion = '') => ({ picked: 'member', character: character(legion) }) as const;
const describeStanding = (s: Standing) =>
  s.kind === 'tier' ? s.tier : s.kind === 'ally' ? `ally:${s.allianceKey}` : s.kind;

function setup(
  options: {
    memberInServer?: boolean;
    takenBy?: string;
    restrictedBy?: 'officer' | 'check';
    refusal?: string;
  } = {},
) {
  const memberInServer = options.memberInServer ?? true;
  const db = openDatabase(':memory:');
  const applications = new ApplicationStore(db.db);
  const sent: { channel: string; content?: string }[] = [];
  const notices: string[] = [];
  const edits: string[] = [];
  const linked: string[] = [];
  const moves: string[] = [];
  const createdAlliances: string[] = [];
  const created: { name: string; type: number; invitable: boolean }[] = [];
  const added: string[] = [];
  const deletedThreads: string[] = [];
  const clock = { now: new Date('2026-11-09T12:00:00Z') };
  const alliances = [{ key: 'ally-noxus', legion: 'Noxus' }];
  const thread = {
    id: 'thread-1',
    archived: false,
    isThread: () => true,
    setArchived: async () => undefined,
    delete: async () => void deletedThreads.push('thread-1'),
    members: { add: async (id: string) => void added.push(id) },
    send: async (message: { content?: string }) => {
      sent.push({ channel: 'thread', ...(message.content && { content: message.content }) });
      return { id: 'card-msg' };
    },
    messages: { fetch: async (id: string) => ({ edit: async () => void edits.push(id) }) },
  };
  const review = {
    threads: {
      create: async (opts: { name: string; type: number; invitable: boolean }) => {
        created.push(opts);
        return thread;
      },
    },
  };
  const officers = {
    ...review,
    send: async (message: { content: string }) => void notices.push(message.content),
  };
  const member = {
    id: 'u1',
    displayName: 'padrinho_discord',
    displayAvatarURL: () => 'https://cdn.discordapp.com/avatar.png',
  };
  const withRoles = (id: string, roles: string[], bot = false) => ({
    id,
    user: { bot },
    roles: { cache: new Set(roles) },
  });
  const everyone = new Map(
    [
      withRoles('officer-1', ['officer-role']),
      withRoles('commander-1', ['commander-role']),
      withRoles('soldier-1', ['soldier-role']),
      withRoles('bot-1', ['officer-role'], true),
    ].map((m) => [m.id, m]),
  );
  const desk = new RecruitmentDesk({
    guild: {
      client: { user: { id: 'padrinho' } },
      members: {
        fetch: async (id?: string) =>
          id === undefined ? everyone : memberInServer ? member : Promise.reject(new Error('gone')),
      },
      channels: { fetch: async (id: string) => (id === thread.id ? thread : null) },
    } as never,
    config: {
      get: () => ({
        alliances,
        settings: {
          characters: { legion: 'M4F1A', reportChannel: 'officers' },
          alliances: { channel: 'alliance-chat' },
          recruitment: {
            channel: 'recruitment',
            reviewChannel: 'recruitment',
            pingRole: 'officer',
          },
        },
      }),
    } as unknown as ConfigStore,
    directory: {
      channelByKey: (key: string) => (key === 'officers' ? officers : review),
      roleId: () => 'officer-role',
      tierRoleIds: () => ({
        officer: 'officer-role',
        commander: 'commander-role',
        soldier: 'soldier-role',
      }),
    } as unknown as GuildDirectory,
    recruitment: new RecruitmentService({
      store: applications,
      runAction: (async (r: { execute: () => Promise<unknown> }) => ({
        status: 'ok',
        value: await r.execute(),
      })) as unknown as ActionRunner,
    }),
    applications,
    registration: {
      classRole: () => ({ key: 'class-cleric', name: 'Clérigo', emoji: '✨' }),
      ownerOf: () => options.takenBy,
      link: async (_actor: Actor, m: { id: string }) => {
        linked.push(m.id);
        return '✨ Padrinho';
      },
    } as unknown as RegistrationService,
    members: {
      refusalFor: () => options.refusal ?? null,
      restrictionOf: () => options.restrictedBy,
      standingName: describeStanding,
      move: async (actor: Actor, userId: string, to: Standing) => {
        moves.push(`${actor.userId} ${userId} ${describeStanding(to)}`);
        return { status: 'ok', value: '' };
      },
    } as unknown as MemberService,
    alliances: {
      add: async (_actor: Actor, legion: string) => {
        createdAlliances.push(legion);
        alliances.push({ key: `ally-${legion.toLowerCase()}`, legion });
        return { status: 'ok', value: '' };
      },
    } as unknown as AllianceService,
    logger: { warn: () => undefined } as unknown as Logger,
    now: () => clock.now,
  });
  return {
    desk,
    applications,
    sent,
    notices,
    edits,
    linked,
    moves,
    createdAlliances,
    created,
    added,
    deletedThreads,
    clock,
  };
}

async function submitted(s: ReturnType<typeof setup>, form: SentForm = asMember()) {
  const outcome = await s.desk.submit(visitor, form);
  if (outcome.status !== 'ok') throw new Error(`not created: ${JSON.stringify(outcome)}`);
  return outcome.value.application;
}

describe('RecruitmentDesk', () => {
  it('posts the card in a private thread with only the applicant and the staff', async () => {
    const s = setup();
    const outcome = await s.desk.submit(visitor, asMember());

    expect(outcome).toMatchObject({ status: 'ok', value: { autoApproved: false } });
    expect(s.created).toEqual([
      expect.objectContaining({
        name: 'Ficha · Padrinho',
        type: ChannelType.PrivateThread,
        invitable: false,
      }),
    ]);
    expect(s.added).toEqual(['u1', 'officer-1', 'commander-1']);
    expect(s.sent).toEqual([
      { channel: 'thread', content: expect.stringContaining('<@&officer-role>') },
    ]);
    expect(s.applications.list()[0]).toMatchObject({
      kind: 'member',
      messageId: 'card-msg',
      threadId: 'thread-1',
    });
  });

  it('approving a Membro registers them, makes them Soldado and welcomes them', async () => {
    const s = setup();
    const application = await submitted(s);

    const outcome = await s.desk.decide(officer, application.id, true);

    expect(outcome).toMatchObject({ status: 'ok', value: { status: 'approved' } });
    expect(s.linked).toEqual(['u1']);
    expect(s.moves).toEqual(['officer u1 soldier']);
    expect(s.edits).toEqual(['card-msg']);
    expect(s.sent.at(-1)).toEqual({
      channel: 'thread',
      content: expect.stringContaining('✨ Padrinho'),
    });
  });

  it('approves a Membro already in the legion on its own and tells the officers', async () => {
    const s = setup();
    const outcome = await s.desk.submit(visitor, asMember('M4F1A'));

    expect(outcome).toMatchObject({
      status: 'ok',
      value: { autoApproved: true, application: { status: 'approved', decidedBy: 'padrinho' } },
    });
    expect(s.moves).toEqual(['padrinho u1 soldier']);
    expect(s.sent.map((m) => m.content)).toEqual([undefined, expect.stringContaining('🎉')]);
    expect(s.notices).toEqual([expect.stringContaining('entrou sozinho')]);
  });

  it('never approves a character someone else has; it waits for an officer, with a warning', async () => {
    const s = setup({ takenBy: 'u9' });
    const outcome = await s.desk.submit(visitor, asMember('M4F1A'));

    expect(outcome).toMatchObject({ status: 'ok', value: { autoApproved: false } });
    expect(s.applications.list()[0]).toMatchObject({ status: 'pending', characterTakenBy: 'u9' });
    expect(s.notices).toEqual([expect.stringContaining('<@u9>')]);
    expect(s.moves).toEqual([]);
  });

  it('does not let someone an officer restricted back in on their own', async () => {
    const s = setup({ restrictedBy: 'officer' });
    const outcome = await s.desk.submit(visitor, asMember('M4F1A'));
    expect(outcome).toMatchObject({ status: 'ok', value: { autoApproved: false } });
    expect(s.moves).toEqual([]);
  });

  it('refuses an Aliança without a legion, and needs a name for Membro', async () => {
    const s = setup();
    expect(
      await s.desk.submit(visitor, { picked: 'ally', character: character('') }),
    ).toMatchObject({ status: 'rejected' });
    expect(await s.desk.submit(visitor, { picked: 'member', character: null })).toMatchObject({
      status: 'rejected',
    });
    expect(s.applications.list()).toEqual([]);
  });

  it('takes a Parceiro without a character', async () => {
    const s = setup();
    const application = await submitted(s, {
      picked: 'partner',
      character: null,
    });
    expect(application).toMatchObject({ kind: 'partner', character: null });
    expect(s.created[0]).toMatchObject({ name: 'Ficha · padrinho_discord' });

    await s.desk.decide(officer, application.id, true);
    expect(s.linked).toEqual([]);
    expect(s.moves).toEqual(['officer u1 partner']);
  });

  it('an Aliança of a known alliance makes them Aliado of it', async () => {
    const s = setup();
    const application = await submitted(s, {
      picked: 'ally',
      character: character('noxus'),
    });
    expect(application).toMatchObject({ kind: 'ally', allianceLegion: 'Noxus' });

    await s.desk.decide(officer, application.id, true);
    expect(s.moves).toEqual(['officer u1 ally:ally-noxus']);
    expect(s.sent.at(-1)?.content).toContain('aliado(a) da **Noxus**');
  });

  it('a new alliance needs a Comandante, and approving creates it', async () => {
    const s = setup();
    const application = await submitted(s, {
      picked: 'ally',
      character: character('Lagta'),
    });

    expect(await s.desk.decide(officer, application.id, true)).toMatchObject({
      status: 'rejected',
    });
    expect(s.createdAlliances).toEqual([]);

    expect(await s.desk.decide(commander, application.id, true)).toMatchObject({ status: 'ok' });
    expect(s.createdAlliances).toEqual(['Lagta']);
    expect(s.moves).toEqual(['commander u1 ally:ally-lagta']);
  });

  it('creates no alliance when the person cannot be moved', async () => {
    const s = setup({ refusal: 'Não dá para fazer isso com um bot.' });
    const application = await submitted(s, {
      picked: 'ally',
      character: character('Lagta'),
    });
    expect(await s.desk.decide(commander, application.id, true)).toMatchObject({
      status: 'rejected',
    });
    expect(s.createdAlliances).toEqual([]);
  });

  it('Mudar switches the type; Aliança takes the character legion', async () => {
    const s = setup();
    const application = await submitted(s, asMember('Noxus'));

    const changed = await s.desk.changeKind(officer, application.id, 'ally');
    expect(changed).toMatchObject({
      status: 'ok',
      value: { kind: 'ally', requestedKind: 'member', allianceLegion: 'Noxus' },
    });
    expect(await s.desk.changeKind(officer, application.id, 'restricted')).toMatchObject({
      status: 'rejected',
    });

    await s.desk.decide(officer, application.id, true);
    expect(s.moves).toEqual(['officer u1 ally:ally-noxus']);
  });

  it('a daily check review goes to the officers; refusing it puts the old standing back', async () => {
    const s = setup();
    await s.desk.openReview({
      userId: 'u1',
      kind: 'restricted',
      character: character('Outra'),
      allianceLegion: null,
      previousStanding: encodeStanding({ kind: 'tier', tier: 'soldier' }),
    });
    const review = s.applications.list()[0]!;
    expect(review).toMatchObject({ origin: 'check', kind: 'restricted' });
    expect(s.created[0]).toMatchObject({ name: 'Análise · Padrinho' });
    expect(s.added).toEqual(['officer-1', 'commander-1']);

    await s.desk.decide(officer, review.id, false);
    expect(s.moves).toEqual(['officer u1 soldier']);
  });

  it('refuses to approve someone who left the server', async () => {
    const s = setup({ memberInServer: false });
    const application = await submitted(s);

    expect(await s.desk.decide(officer, application.id, true)).toMatchObject({
      status: 'rejected',
    });
    expect(s.applications.get(application.id)!.status).toBe('pending');
  });

  const later = (clock: { now: Date }, minutes: number) =>
    (clock.now = new Date(clock.now.getTime() + minutes * 60_000));

  it("deletes an approved application's thread an hour after the decision", async () => {
    const s = setup();
    const application = await submitted(s);
    await s.desk.decide(officer, application.id, true);
    s.clock.now = s.applications.get(application.id)!.decidedAt!;

    later(s.clock, 59);
    expect(await s.desk.sweepThreads()).toBe(0);
    later(s.clock, 1);
    expect(await s.desk.sweepThreads()).toBe(1);
    expect(s.deletedThreads).toEqual(['thread-1']);
    expect(s.applications.get(application.id)).toMatchObject({ threadId: null, messageId: null });
    expect(await s.desk.sweepThreads()).toBe(0);
  });

  it("keeps a refused application's thread for six hours", async () => {
    const s = setup();
    const application = await submitted(s);
    await s.desk.decide(officer, application.id, false);
    s.clock.now = s.applications.get(application.id)!.decidedAt!;

    later(s.clock, 5 * 60 + 59);
    expect(await s.desk.sweepThreads()).toBe(0);
    later(s.clock, 1);
    expect(await s.desk.sweepThreads()).toBe(1);
    expect(s.deletedThreads).toEqual(['thread-1']);
  });

  it("leaves pending applications' threads alone", async () => {
    const s = setup();
    await submitted(s);
    later(s.clock, 7 * 24 * 60);
    expect(await s.desk.sweepThreads()).toBe(0);
    expect(s.deletedThreads).toEqual([]);
  });
});
