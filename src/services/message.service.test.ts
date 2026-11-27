import { describe, expect, it } from 'vitest';
import type { Actor } from '../core/actor.js';
import { ptBR } from '../i18n/pt-BR.js';
import { MessageService } from './message.service.js';
import { FakeGuildAdmin } from './testing/fake-guild-admin.js';
import { recordingRunner } from './testing/recording-runner.js';

const officer: Actor = { userId: 'u-off', tier: 'officer', source: 'slash' };
const soldier: Actor = { userId: 'u-sol', tier: 'soldier', source: 'slash' };

function setup() {
  const guild = new FakeGuildAdmin();
  const channel = guild.seedChannel({ name: 'avisos', kind: 'text' });
  const { runAction, audit } = recordingRunner();
  const service = new MessageService({ guild, runAction });
  return { guild, channel, service, audit };
}

describe('MessageService.send', () => {
  it('sends up to 2000 characters as a plain message without pinging anyone', async () => {
    const { guild, channel, service } = setup();
    const text = 'a'.repeat(2000);

    expect(await service.send(officer, channel.id, text)).toEqual({
      status: 'ok',
      value: ptBR.say.sent('avisos'),
    });
    expect(guild.sent).toEqual([
      { channelId: channel.id, message: { allowMentions: false, content: text } },
    ]);
  });

  it('sends longer text, or text with a title, as an embed', async () => {
    const { guild, channel, service } = setup();
    const long = 'a'.repeat(2001);

    await service.send(officer, channel.id, long);
    await service.send(officer, channel.id, 'Hoje 21h', {
      title: 'Guerra do Abismo',
      allowMentions: true,
    });

    expect(guild.sent.map((s) => s.message)).toEqual([
      { allowMentions: false, embed: { description: long } },
      { allowMentions: true, embed: { description: 'Hoje 21h', title: 'Guerra do Abismo' } },
    ]);
  });

  it('refuses a channel that takes no messages only after checking the rank', async () => {
    const { guild, service, audit } = setup();
    const forum = guild.seedChannel({ name: 'builds', kind: 'forum' });

    expect(await service.send(soldier, forum.id, 'oi')).toEqual({
      status: 'denied',
      requiredTier: 'officer',
    });
    expect(await service.send(officer, forum.id, 'oi')).toEqual({
      status: 'rejected',
      reason: ptBR.moderation.notText,
    });
    expect(audit.map((e) => e.result)).toEqual(['denied', 'rejected']);
    expect(guild.sent).toEqual([]);
  });
});

describe('MessageService.read', () => {
  it('returns the last messages oldest first', async () => {
    const { guild, channel, service } = setup();
    const padrinho = guild.seedMember({ displayName: 'Padrinho' });
    for (const [age, content] of [
      [3000, 'primeira'],
      [2000, 'segunda'],
      [1000, 'terceira'],
    ] as const) {
      guild.seedMessage(channel.id, padrinho.id, age, content);
    }

    const outcome = await service.read(officer, 'avisos', 2);

    expect(outcome.status === 'ok' && outcome.value.map((m) => m.content)).toEqual([
      'segunda',
      'terceira',
    ]);
  });

  it('does not tell a Soldado whether the channel exists', async () => {
    const { service } = setup();

    expect(await service.read(soldier, 'secreto', 10)).toEqual({
      status: 'denied',
      requiredTier: 'officer',
    });
    expect(await service.read(soldier, 'avisos', 10)).toEqual({
      status: 'denied',
      requiredTier: 'officer',
    });
  });
});
