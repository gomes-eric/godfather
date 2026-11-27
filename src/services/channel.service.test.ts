import { describe, expect, it } from 'vitest';
import type { Actor } from '../core/actor.js';
import { openDatabase } from '../db/client.js';
import { ManagedObjectStore } from '../db/managed-objects.js';
import { ptBR } from '../i18n/pt-BR.js';
import { ChannelService } from './channel.service.js';
import { FakeGuildAdmin } from './testing/fake-guild-admin.js';
import { recordingRunner } from './testing/recording-runner.js';

const t = ptBR.channels;
const commander: Actor = { userId: 'u-cmd', tier: 'commander', source: 'mcp' };
const officer: Actor = { userId: 'u-off', tier: 'officer', source: 'mcp' };

function setup() {
  const guild = new FakeGuildAdmin();
  const managed = new ManagedObjectStore(openDatabase(':memory:').db);
  const { runAction, audit } = recordingRunner();
  const service = new ChannelService({ guild, managed, runAction });
  return { guild, managed, service, audit };
}

describe('ChannelService', () => {
  it('creates a channel in a category, with only the fields its kind takes', async () => {
    const { guild, service } = setup();
    const category = guild.seedChannel({ name: 'Raides', kind: 'category' });

    const voice = await service.create(commander, {
      name: 'Raide 1',
      type: 'voice',
      category: 'Raides',
      topic: 'ignorado',
      userLimit: 8,
    });

    const created = guild.channelList.find((c) => c.name === 'Raide 1');
    expect(voice).toEqual({ status: 'ok', value: t.created('Raide 1', created!.id) });
    expect(created).toMatchObject({ parentId: category.id, userLimit: 8, topic: null });
  });

  it('says a category does not exist only after checking the rank', async () => {
    const { service } = setup();
    const input = { name: 'geral', type: 'text', category: 'Fantasma' } as const;

    expect(await service.create(officer, input)).toMatchObject({ status: 'denied' });
    expect(await service.create(commander, input)).toEqual({
      status: 'rejected',
      reason: ptBR.resolve.none(ptBR.resolve.what.category, 'Fantasma'),
    });
  });

  it('edits only what the channel has', async () => {
    const { guild, service } = setup();
    const voice = guild.seedChannel({ name: 'Social', kind: 'voice' });
    const text = guild.seedChannel({ name: 'geral', kind: 'text' });

    expect(await service.edit(commander, 'Social', { topic: 'x', userLimit: 5 })).toEqual({
      status: 'ok',
      value: t.edited(voice.id),
    });
    expect(await service.edit(commander, 'geral', { topic: 'Bem-vindos', userLimit: 5 })).toEqual({
      status: 'ok',
      value: t.edited(text.id),
    });
    expect(voice).toMatchObject({ userLimit: 5, topic: null });
    expect(text).toMatchObject({ userLimit: 0, topic: 'Bem-vindos' });
  });

  it('warns before deleting a channel from server.yaml', async () => {
    const { guild, managed, service, audit } = setup();
    const rules = guild.seedChannel({ name: 'regras', kind: 'text' });
    managed.set('channel', 'rules', rules.id);

    const outcome = await service.delete(commander, 'regras', false);

    expect(outcome).toEqual({
      status: 'confirmation_required',
      preview: t.deletePreview('regras', true),
    });
    expect(audit[0]).toMatchObject({ params: { channelId: rules.id, managed: true } });
  });

  it('deletes a hand-made channel once confirmed', async () => {
    const { guild, service, audit } = setup();
    const spare = guild.seedChannel({ name: 'avulso', kind: 'text' });

    expect(await service.delete(commander, 'avulso', true)).toEqual({
      status: 'ok',
      value: t.deleted('avulso'),
    });
    expect(guild.channelList.some((c) => c.id === spare.id)).toBe(false);
    expect(audit[0]).toMatchObject({ result: 'ok', params: { managed: false } });
  });
});
