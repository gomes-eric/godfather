import { describe, expect, it, vi } from 'vitest';
import { createActionRunner, refusedRequest } from './action.js';
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

  it('audits denied reads through MCP, so a demoted token owner shows up', async () => {
    const { run, entries } = setup();
    const read = (source: 'mcp' | 'slash') =>
      run({
        actor: { ...officer, tier: 'visitor', source },
        action: 'member.read',
        preview: 'Listar membros',
        execute: vi.fn(),
      });

    expect(await read('mcp')).toEqual({ status: 'denied', requiredTier: 'officer' });
    expect(await read('slash')).toEqual({ status: 'denied', requiredTier: 'officer' });
    expect(entries).toEqual([
      expect.objectContaining({
        action: 'member.read',
        result: 'denied',
        actor: expect.objectContaining({ source: 'mcp' }),
      }),
    ]);
  });
});

describe('domain checks', () => {
  it('only run once the actor holds the rank', async () => {
    const { run, entries } = setup();
    const check = vi.fn(() => 'Você só pode moderar quem está abaixo do seu cargo.');

    const outcome = await run({
      actor: { ...officer, tier: 'soldier' },
      action: 'member.kick',
      target: 'Padrinho',
      preview: 'Expulsar Padrinho',
      checkAfterAuthorization: check,
      execute: vi.fn(),
    });

    expect(outcome).toEqual({ status: 'denied', requiredTier: 'officer' });
    expect(check).not.toHaveBeenCalled();
    expect(entries.map((e) => e.result)).toEqual(['denied']);
  });

  it('refuse before the confirmation prompt and audit the refusal with its reason', async () => {
    const { run, entries } = setup();
    const execute = vi.fn();

    const outcome = await run({
      actor: officer,
      action: 'member.kick',
      target: 'Padrinho',
      params: { userId: '42' },
      preview: 'Expulsar Padrinho',
      checkAfterAuthorization: () => 'Você só pode moderar quem está abaixo do seu cargo.',
      execute,
    });

    expect(outcome).toEqual({
      status: 'rejected',
      reason: 'Você só pode moderar quem está abaixo do seu cargo.',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(entries).toEqual([
      expect.objectContaining({
        action: 'member.kick',
        result: 'rejected',
        target: 'Padrinho',
        params: { userId: '42', refusal: 'Você só pode moderar quem está abaixo do seu cargo.' },
      }),
    ]);
  });

  it('let the action go on when they pass', async () => {
    const { run } = setup();
    const outcome = await run({
      actor: officer,
      action: 'member.kick',
      preview: 'Expulsar Padrinho',
      checkAfterAuthorization: () => null,
      execute: vi.fn(),
    });

    expect(outcome).toEqual({ status: 'confirmation_required', preview: 'Expulsar Padrinho' });
  });

  it('keep refusals of read-only actions out of the audit', async () => {
    const { run, entries } = setup();
    const outcome = await run({
      actor: officer,
      action: 'message.read',
      preview: 'Ler #geral',
      checkAfterAuthorization: () => 'Esse canal não aceita mensagens.',
      execute: vi.fn(),
    });

    expect(outcome.status).toBe('rejected');
    expect(entries).toEqual([]);
  });

  it('answer a missing target with a denial to those without the rank', async () => {
    const { run, entries } = setup();
    const request = refusedRequest(
      { actor: officer, action: 'mcp.token.revoke.any', target: '#9' },
      'Não achei o token #9.',
    );

    expect(await run(request)).toEqual({ status: 'denied', requiredTier: 'commander' });
    expect(await run({ ...request, actor: commander })).toEqual({
      status: 'rejected',
      reason: 'Não achei o token #9.',
    });
    expect(entries.map((e) => e.result)).toEqual(['denied', 'rejected']);
  });
});
