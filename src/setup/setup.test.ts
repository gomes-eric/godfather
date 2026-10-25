import { PermissionFlagsBits as P } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadServerConfig } from '../config/loader.js';
import { openDatabase, type DatabaseHandle } from '../db/client.js';
import { ManagedObjectStore } from '../db/managed-objects.js';
import { applySetup, panelMessagesToCheck } from './applier.js';
import { buildDesiredState, PANEL_KEYS } from './desired.js';
import type { DesiredState } from './model.js';
import { planSetup } from './planner.js';
import { FakeGuild } from './testing/fake-guild.js';

const repoConfig = loadServerConfig(fileURLToPath(new URL('../../server.yaml', import.meta.url)));

describe('/setup reconciliation', () => {
  let handle: DatabaseHandle;
  let store: ManagedObjectStore;
  let guild: FakeGuild;

  beforeEach(() => {
    handle = openDatabase(':memory:');
    store = new ManagedObjectStore(handle.db);
    guild = new FakeGuild();
  });
  afterEach(() => handle.close());

  async function plan(desired: DesiredState, prune = false) {
    const snapshot = await guild.snapshot(panelMessagesToCheck(store, desired.panels));
    return { snapshot, plan: planSetup({ desired, snapshot, managed: store.all(), prune }) };
  }

  async function setup(desired: DesiredState, prune = false) {
    const { snapshot, plan: p } = await plan(desired, prune);
    const result = await applySetup(p, { port: guild, store, snapshot });
    return { plan: p, result };
  }

  it('builds the whole server from server.yaml and a second run changes nothing', async () => {
    const desired = buildDesiredState(repoConfig);

    const first = await setup(desired);
    expect(first.result.failures).toEqual([]);
    expect(first.plan.warnings).toEqual([]);

    const second = await plan(desired);
    expect(second.plan.ops).toEqual([]);

    const names = guild.channels.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['regras', 'tutoriais', 'musica', '➕ Abismo']));
    expect(guild.community).toBe(true);
    expect(guild.messages.size).toBe(2);
  });

  it('puts every managed role below the bot in the yaml order', async () => {
    await setup(buildDesiredState(repoConfig));

    const order = guild.roles
      .filter((r) => r.position < guild.botRolePosition && r.id !== guild.everyoneRoleId)
      .sort((a, b) => b.position - a.position)
      .map((r) => r.name);
    expect(order).toEqual(repoConfig.roles.map((r) => r.name));
  });

  it('gives #musica slash commands but no messages for soldiers', async () => {
    await setup(buildDesiredState(repoConfig));
    const soldierId = store.get('role', 'soldier')!.discordId;
    const musica = guild.channels.find((c) => c.name === 'musica')!;

    const everyone = musica.overwrites.find((o) => o.id === guild.everyoneRoleId)!;
    const soldier = musica.overwrites.find((o) => o.id === soldierId)!;
    expect(everyone.deny & P.SendMessages).toBe(P.SendMessages);
    expect(soldier.allow & P.SendMessages).toBe(0n);
    expect(soldier.allow & P.UseApplicationCommands).toBe(P.UseApplicationCommands);
  });

  it('renaming in the yaml edits the same channel instead of creating one', async () => {
    await setup(buildDesiredState(repoConfig));
    const geralId = store.get('channel', 'general')!.discordId;

    const renamed = structuredClone(repoConfig);
    renamed.categories
      .find((c) => c.key === 'legion')!
      .channels.find((c) => c.key === 'general')!.name = 'bate-papo';
    const { plan: p } = await setup(buildDesiredState(renamed));

    expect(p.ops).toEqual([
      expect.objectContaining({ type: 'updateChannel', id: geralId, changes: ['name'] }),
    ]);
    expect(guild.channels.find((c) => c.id === geralId)?.name).toBe('bate-papo');
  });

  it('adopts an existing channel with the same name and type', async () => {
    const existingId = guild.addChannel({ name: 'geral', kind: 'text' });

    const { plan: p } = await setup(buildDesiredState(repoConfig));

    expect(p.ops[0]).toEqual(
      expect.objectContaining({ type: 'adopt', kind: 'channel', key: 'general', id: existingId }),
    );
    expect(store.get('channel', 'general')?.discordId).toBe(existingId);
  });

  it('leaves overwrites it does not own untouched', async () => {
    await setup(buildDesiredState(repoConfig));
    const geral = guild.channels.find((c) => c.name === 'geral')!;
    geral.overwrites.push({ id: '42', type: 'member', allow: P.ManageMessages, deny: 0n });

    const { plan: p } = await plan(buildDesiredState(repoConfig));
    expect(p.ops).toEqual([]);

    geral.name = 'drift';
    await setup(buildDesiredState(repoConfig));
    expect(geral.overwrites).toContainEqual(expect.objectContaining({ id: '42', type: 'member' }));
  });

  it('leaves a role above the bot alone, warns about its differences, and still converges', async () => {
    const commanderId = guild.addRoleAboveBot('Comandante');

    const first = await setup(buildDesiredState(repoConfig));
    expect(first.plan.warnings).toEqual([
      {
        type: 'roleAboveBot',
        key: 'commander',
        name: 'Comandante',
        changes: ['color', 'hoist', 'permissions'],
      },
    ]);
    expect(first.result.failures).toEqual([]);
    expect(store.get('role', 'commander')?.discordId).toBe(commanderId);

    const second = await plan(buildDesiredState(repoConfig));
    expect(second.plan.ops).toEqual([]);
    expect(second.plan.warnings).toHaveLength(1);
  });

  it('does not warn about a role above the bot that already matches the yaml', async () => {
    const commanderId = guild.addRoleAboveBot('Comandante');
    Object.assign(
      guild.roles.find((r) => r.id === commanderId)!,
      {
        color: 0xe0303a,
        hoist: true,
        permissions: P.Administrator,
      },
    );

    const { plan: p } = await setup(buildDesiredState(repoConfig));
    expect(p.warnings).toEqual([]);
  });

  it('gives Administrator roles no channel overwrites', async () => {
    const commanderId = guild.addRoleAboveBot('Comandante');
    await setup(buildDesiredState(repoConfig));

    const withCommander = guild.channels.filter((c) =>
      c.overwrites.some((o) => o.id === commanderId),
    );
    expect(withCommander).toEqual([]);
  });

  it('reports a Community failure and creates the channels that do not need it', async () => {
    guild.failCommunity = true;

    const { result } = await setup(buildDesiredState(repoConfig));

    const failedTypes = result.failures.map((f) => f.op.type);
    expect(failedTypes).toContain('enableCommunity');
    expect(guild.channels.some((c) => c.name === 'geral')).toBe(true);
    expect(guild.channels.some((c) => c.kind === 'forum')).toBe(false);
  });

  it('re-posts a panel whose message was deleted and edits one whose content changed', async () => {
    await setup(buildDesiredState(repoConfig));
    const rulesMessageId = store.get('message', PANEL_KEYS.rules)!.discordId;

    guild.messages.delete(rulesMessageId);
    const changed = structuredClone(repoConfig);
    changed.settings.rolePicker.multipleClasses = true;
    const { plan: p } = await setup(buildDesiredState(changed));

    const panelOps = p.ops.filter((op) => op.type === 'upsertPanel');
    expect(panelOps).toEqual([
      expect.objectContaining({
        panel: expect.objectContaining({ key: PANEL_KEYS.rules }),
        messageId: null,
      }),
      expect.objectContaining({
        panel: expect.objectContaining({ key: PANEL_KEYS.rolePicker }),
        messageId: expect.any(String),
      }),
    ]);
  });

  it('only deletes things removed from the yaml when prune is on', async () => {
    await setup(buildDesiredState(repoConfig));
    const without = structuredClone(repoConfig);
    without.categories = without.categories.filter((c) => c.key !== 'operations');

    const { plan: kept } = await plan(buildDesiredState(without));
    expect(kept.ops.some((op) => op.type.startsWith('delete'))).toBe(false);

    const { plan: pruned } = await setup(buildDesiredState(without), true);
    const deleted = pruned.ops.filter((op) => op.type.startsWith('delete')).map((op) => op.type);
    expect(deleted).toEqual([
      'deleteChannel',
      'deleteChannel',
      'deleteChannel',
      'deleteChannel',
      'deleteChannel',
      'deleteCategory',
    ]);
    expect(guild.channels.some((c) => c.name === 'abismo')).toBe(false);
  });

  it('never touches items marked managed: false', async () => {
    const config = structuredClone(repoConfig);
    config.categories.find((c) => c.key === 'afk')!.managed = false;
    const desired = buildDesiredState(config);

    expect(desired.categories.some((c) => c.key === 'afk')).toBe(false);
    expect(desired.unmanagedKeys.category.has('afk')).toBe(true);
  });
});
