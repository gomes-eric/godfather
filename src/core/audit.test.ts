import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../db/client.js';
import type { Actor } from './actor.js';
import { AuditLog, sanitizeParams, type AuditPublisher } from './audit.js';

const logger = pino({ level: 'silent' });
const actor: Actor = { userId: '111', tier: 'officer', source: 'mcp', harness: 'codex' };

describe('AuditLog', () => {
  let handle: DatabaseHandle;

  afterEach(() => handle.close());

  it('persists entries and returns the newest first', async () => {
    handle = openDatabase(':memory:');
    const audit = new AuditLog(handle.db, logger);

    await audit.record({ actor, action: 'message.send', result: 'ok' });
    await audit.record({ actor, action: 'member.kick', target: '@Fulano', result: 'denied' });

    const rows = audit.recent(10);
    expect(rows.map((r) => r.action)).toEqual(['member.kick', 'message.send']);
    expect(rows[0]).toMatchObject({
      actorId: '111',
      actorTier: 'officer',
      source: 'mcp',
      harness: 'codex',
      target: '@Fulano',
      result: 'denied',
    });
  });

  it('stores system actors with the system tier', async () => {
    handle = openDatabase(':memory:');
    const audit = new AuditLog(handle.db, logger);

    await audit.record({
      actor: { userId: 'bot', tier: 'commander', source: 'system' },
      action: 'setup.apply',
      result: 'ok',
    });

    expect(audit.recent(1)[0]?.actorTier).toBe('system');
  });

  it('redacts secrets before storing and publishing', async () => {
    handle = openDatabase(':memory:');
    const publish = vi.fn<AuditPublisher['publish']>().mockResolvedValue();
    const audit = new AuditLog(handle.db, logger, { publish });

    await audit.record({
      actor,
      action: 'mcp.token.create',
      params: { name: 'laptop', token: 'pdr_secret' },
      result: 'ok',
    });

    expect(audit.recent(1)[0]?.paramsJson).toBe('{"name":"laptop","token":"[redacted]"}');
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ params: { name: 'laptop', token: '[redacted]' } }),
    );
  });

  it('keeps the entry when publishing to Discord fails', async () => {
    handle = openDatabase(':memory:');
    const audit = new AuditLog(handle.db, logger, {
      publish: () => Promise.reject(new Error('Missing Access')),
    });

    await expect(
      audit.record({ actor, action: 'message.send', result: 'ok' }),
    ).resolves.toMatchObject({ action: 'message.send' });
    expect(audit.recent(10)).toHaveLength(1);
  });
});

describe('sanitizeParams', () => {
  it('redacts keys that look like secrets, case-insensitively', () => {
    expect(sanitizeParams({ Authorization: 'Bearer x', apiSecret: 'y', limit: 5 })).toEqual({
      Authorization: '[redacted]',
      apiSecret: '[redacted]',
      limit: 5,
    });
  });
});
