import { ChannelType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { ConfigStore } from '../config/store.js';
import type { ActionRunner } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { ApplicationStore } from '../db/applications.js';
import { openDatabase } from '../db/client.js';
import type { GuildDirectory } from '../discord/directory.js';
import type { Logger } from '../logger.js';
import { RecruitmentDesk } from './recruitment-desk.service.js';
import { RecruitmentService } from './recruitment.service.js';
import type { RegistrationService } from './registration.service.js';

const officer: Actor = { userId: 'officer', tier: 'officer', source: 'mcp' };
const visitor: Actor = { userId: 'u1', tier: 'visitor', source: 'slash' };
const character = {
  id: 'c1',
  name: 'Padrinho',
  serverId: 2403,
  className: 'Clérigo',
  level: 45,
  combatPower: 100_000,
  itemLevel: 2000,
  legion: '',
  title: null,
  avatarUrl: null,
};

function setup(memberInServer = true) {
  const db = openDatabase(':memory:');
  const applications = new ApplicationStore(db.db);
  const sent: { channel: string; content?: string }[] = [];
  const edits: string[] = [];
  const admitted: string[] = [];
  const created: { name: string; type: number; invitable: boolean }[] = [];
  const added: string[] = [];
  const thread = {
    id: 'thread-1',
    archived: false,
    isThread: () => true,
    setArchived: async () => undefined,
    members: { add: async (id: string) => void added.push(id) },
    send: async (message: { content?: string }) => {
      sent.push({ channel: 'thread', ...(message.content && { content: message.content }) });
      return { id: 'card-msg' };
    },
    messages: { fetch: async (id: string) => ({ edit: async () => void edits.push(id) }) },
  };
  const review = {
    threads: {
      create: async (options: { name: string; type: number; invitable: boolean }) => {
        created.push(options);
        return thread;
      },
    },
  };
  const member = { id: 'u1', displayAvatarURL: () => 'https://cdn.discordapp.com/avatar.png' };
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
      members: {
        fetch: async (id?: string) =>
          id === undefined ? everyone : memberInServer ? member : Promise.reject(new Error('gone')),
      },
      channels: { fetch: async (id: string) => (id === thread.id ? thread : null) },
    } as never,
    config: {
      get: () => ({
        settings: {
          characters: { legion: 'M4F1A' },
          recruitment: {
            channel: 'recruitment',
            reviewChannel: 'recruitment',
            pingRole: 'officer',
          },
        },
      }),
    } as unknown as ConfigStore,
    directory: {
      channelByKey: () => review,
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
      admit: async (_actor: Actor, m: { id: string }) => {
        admitted.push(m.id);
        return { nickname: '✨ Padrinho', promoted: true };
      },
    } as unknown as RegistrationService,
    logger: { warn: () => undefined } as unknown as Logger,
  });
  return { desk, applications, sent, edits, admitted, created, added };
}

describe('RecruitmentDesk', () => {
  it('posts the card in a private thread with only the applicant and the staff', async () => {
    const { desk, applications, sent, created, added } = setup();
    const outcome = await desk.submit(visitor, character);

    expect(outcome.status).toBe('ok');
    expect(created).toEqual([
      expect.objectContaining({
        name: 'Ficha · Padrinho',
        type: ChannelType.PrivateThread,
        invitable: false,
      }),
    ]);
    expect(added).toEqual(['u1', 'officer-1', 'commander-1']);
    expect(sent).toEqual([
      { channel: 'thread', content: expect.stringContaining('<@&officer-role>') },
    ]);
    expect(applications.list()[0]).toMatchObject({ messageId: 'card-msg', threadId: 'thread-1' });
  });

  it('approving registers them, updates the card and welcomes them in the thread', async () => {
    const { desk, sent, edits, admitted } = setup();
    const created = await desk.submit(visitor, character);
    if (created.status !== 'ok') throw new Error('not created');

    const outcome = await desk.decide(officer, created.value.id, true);

    expect(outcome).toMatchObject({ status: 'ok', value: { status: 'approved' } });
    expect(admitted).toEqual(['u1']);
    expect(edits).toEqual(['card-msg']);
    expect(sent.at(-1)).toEqual({
      channel: 'thread',
      content: expect.stringContaining('✨ Padrinho'),
    });
  });

  it('refuses to approve someone who left the server', async () => {
    const { desk, applications } = setup(false);
    const created = await desk.submit(visitor, character);
    if (created.status !== 'ok') throw new Error('not created');

    expect(await desk.decide(officer, created.value.id, true)).toMatchObject({
      status: 'rejected',
    });
    expect(applications.get(created.value.id)!.status).toBe('pending');
  });
});
