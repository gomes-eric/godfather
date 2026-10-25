import { describe, expect, it, vi } from 'vitest';
import { createActionRunner } from './action.js';
import type { Actor } from './actor.js';
import type { AuditEntry } from './audit.js';

const officer: Actor = { userId: 'u-off', tier: 'officer', source: 'mcp', harness: 'claude-code' };
const commander: Actor = { userId: 'u-cmd', tier: 'commander', source: 'slash' };

function setup() {
  const entries: AuditEntry[] = [];
  const run = createActionRunner({
    record: async (entry) => {
      entries.push(entry);
      return { ...entry, id: entries.length, at: new Date() };
    },
  });
  return { run, entries };
}

describe('action pipeline', () => {
  it('denies without executing and audits the attempt', async () => {
    const { run, entries } = setup();
    const execute = vi.fn();

    const outcome = await run({
      actor: officer,
      action: 'member.ban',
      target: '@Fulano',
      preview: 'Banir @Fulano',
      execute,
    });

    expect(outcome).toEqual({ status: 'denied', requiredTier: 'commander' });
    expect(execute).not.toHaveBeenCalled();
    expect(entries).toEqual([
      expect.objectContaining({ action: 'member.ban', result: 'denied', target: '@Fulano' }),
    ]);
  });

  it('returns a preview instead of running a destructive action without confirm', async () => {
    const { run, entries } = setup();
    const execute = vi.fn();

    const outcome = await run({
      actor: commander,
      action: 'member.ban',
      preview: 'Banir @Fulano (Soldado).',
      execute,
    });

    expect(outcome).toEqual({
      status: 'confirmation_required',
      preview: 'Banir @Fulano (Soldado).',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(entries.map((e) => e.result)).toEqual(['confirmation_required']);
  });

  it('treats confirm values other than true as unconfirmed', async () => {
    const { run } = setup();
    const outcome = await run({
      actor: commander,
      action: 'channel.delete',
      confirm: 'true' as unknown as boolean,
      preview: 'Apagar #geral',
      execute: vi.fn(),
    });

    expect(outcome.status).toBe('confirmation_required');
  });

  it('runs a confirmed destructive action and audits success', async () => {
    const { run, entries } = setup();

    const outcome = await run({
      actor: commander,
      action: 'member.ban',
      confirm: true,
      params: { userId: '42', deleteMessageSeconds: 0 },
      preview: 'Banir @Fulano',
      execute: async () => 'banned',
    });

    expect(outcome).toEqual({ status: 'ok', value: 'banned' });
    expect(entries).toEqual([
      expect.objectContaining({
        result: 'ok',
        params: { userId: '42', deleteMessageSeconds: 0 },
      }),
    ]);
  });

  it('runs non-destructive actions without confirm', async () => {
    const { run } = setup();
    const outcome = await run({
      actor: officer,
      action: 'message.send',
      preview: 'Enviar mensagem',
      execute: async () => 'sent',
    });

    expect(outcome).toEqual({ status: 'ok', value: 'sent' });
  });

  it('audits failures and rethrows the original error', async () => {
    const { run, entries } = setup();
    const failure = new Error('Missing Permissions');

    await expect(
      run({
        actor: officer,
        action: 'message.send',
        preview: 'Enviar mensagem',
        execute: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(entries.map((e) => e.result)).toEqual(['error']);
  });

  it('does not audit read-only actions', async () => {
    const { run, entries } = setup();
    const outcome = await run({
      actor: officer,
      action: 'audit.read',
      preview: 'Ler auditoria',
      execute: async () => [],
    });

    expect(outcome.status).toBe('ok');
    expect(entries).toEqual([]);
  });
});
