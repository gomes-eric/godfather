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
  const channel = (name: string) => ({
    send: async (message: { content?: string }) => {
      sent.push({ channel: name, ...(message.content && { content: message.content }) });
      return { id: `${name}-msg` };
    },
    messages: {
      fetch: async (id: string) => ({ edit: async () => void edits.push(id) }),
    },
  });
  const member = { id: 'u1', displayAvatarURL: () => 'https://cdn.discordapp.com/avatar.png' };
  const desk = new RecruitmentDesk({
    guild: {
      members: { fetch: async () => (memberInServer ? member : Promise.reject(new Error('gone'))) },
    } as never,
    config: {
      get: () => ({
        settings: {
          characters: { legion: 'M4F1A' },
          recruitment: {
            channel: 'recruitment',
            reviewChannel: 'recruitment',
            announceChannel: 'recruitment',
            pingRole: 'officer',
          },
        },
      }),
    } as unknown as ConfigStore,
    directory: {
      channelByKey: (key: string) => channel(key),
      roleId: () => 'officer-role',
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
  return { desk, applications, sent, edits, admitted };
}

describe('RecruitmentDesk', () => {
  it('posts the card for the officers and remembers it', async () => {
    const { desk, applications, sent } = setup();
    const outcome = await desk.submit(visitor, { character, reason: 'r', schedule: 's' });

    expect(outcome.status).toBe('ok');
    expect(sent[0]!.content).toContain('<@&officer-role>');
    expect(applications.list()[0]!.messageId).toBe('recruitment-msg');
  });

  it('approving registers them, updates the card and welcomes them in the channel', async () => {
    const { desk, sent, edits, admitted } = setup();
    const created = await desk.submit(visitor, { character, reason: 'r', schedule: 's' });
    if (created.status !== 'ok') throw new Error('not created');

    const outcome = await desk.decide(officer, created.value.id, true);

    expect(outcome).toMatchObject({ status: 'ok', value: { status: 'approved' } });
    expect(admitted).toEqual(['u1']);
    expect(edits).toEqual(['recruitment-msg']);
    expect(sent.at(-1)!.content).toContain('✨ Padrinho');
  });

  it('refuses to approve someone who left the server', async () => {
    const { desk, applications } = setup(false);
    const created = await desk.submit(visitor, { character, reason: 'r', schedule: 's' });
    if (created.status !== 'ok') throw new Error('not created');

    expect(await desk.decide(officer, created.value.id, true)).toMatchObject({
      status: 'rejected',
    });
    expect(applications.get(created.value.id)!.status).toBe('pending');
  });
});
