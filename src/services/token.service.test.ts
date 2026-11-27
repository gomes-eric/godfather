import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../core/actor.js';
import type { Tier } from '../core/tiers.js';
import { openDatabase } from '../db/client.js';
import { mcpTokens } from '../db/schema.js';
import { ptBR } from '../i18n/pt-BR.js';
import { recordingRunner } from './testing/recording-runner.js';
import { TokenService } from './token.service.js';

const actor = (userId: string, tier: Tier): Actor => ({ userId, tier, source: 'slash' });
const padrinho = actor('u-padrinho', 'officer');

function setup() {
  const { db } = openDatabase(':memory:');
  const { runAction, audit } = recordingRunner();
  let now = new Date('2026-11-27T12:00:00Z');
  const service = new TokenService(db, runAction, () => now);
  const row = (id: number) => db.select().from(mcpTokens).where(eq(mcpTokens.id, id)).get();
  const created = async (owner: Actor = padrinho, name = 'notebook') => {
    const outcome = await service.create(owner, name);
    if (outcome.status !== 'ok') throw new Error(`token not created: ${outcome.status}`);
    return outcome.value;
  };
  return { service, audit, row, created, tick: (at: string) => (now = new Date(at)) };
}

describe('TokenService.create', () => {
  it('returns the token once and stores only its SHA-256 hash', async () => {
    const { audit, row, created } = setup();

    const { token, id } = await created();

    expect(token).toMatch(/^pdr_[A-Za-z0-9_-]{43}$/);
    const stored = row(id)!;
    expect(stored).toMatchObject({ userId: padrinho.userId, name: 'notebook' });
    expect(stored.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it('needs an Oficial', async () => {
    const { service } = setup();
    expect(await service.create(actor('u-sol', 'soldier'), 'notebook')).toEqual({
      status: 'denied',
      requiredTier: 'officer',
    });
  });
});

describe('TokenService.verify', () => {
  it('accepts a live token and stamps when it was used', async () => {
    const { service, row, created, tick } = setup();
    const { token, id } = await created();
    tick('2026-11-28T08:30:00Z');

    expect(service.verify(token)).toEqual({ userId: padrinho.userId, tokenId: id });
    expect(row(id)!.lastUsedAt).toEqual(new Date('2026-11-28T08:30:00Z'));
  });

  it('rejects tokens without the prefix, unknown tokens and revoked ones', async () => {
    const { service, row, created } = setup();
    const { token, id } = await created();

    expect(service.verify(token.slice(4))).toBeNull();
    expect(service.verify(`${token}x`)).toBeNull();
    await service.revoke(padrinho, id);
    expect(service.verify(token)).toBeNull();
    expect(row(id)!.lastUsedAt).toBeNull();
  });
});

describe('TokenService.revoke', () => {
  it('lets an Oficial revoke their own token', async () => {
    const { service, audit, row, created } = setup();
    const { id } = await created();

    expect(await service.revoke(padrinho, id)).toEqual({
      status: 'ok',
      value: ptBR.mcp.revoked('notebook'),
    });
    expect(row(id)!.revokedAt).not.toBeNull();
    expect(audit.at(-1)).toMatchObject({ action: 'mcp.token.revoke.own', result: 'ok' });
  });

  it("keeps someone else's token for a Comandante to revoke", async () => {
    const { service, row, created } = setup();
    const { id } = await created();

    expect(await service.revoke(actor('u-other', 'officer'), id)).toEqual({
      status: 'denied',
      requiredTier: 'commander',
    });
    expect(row(id)!.revokedAt).toBeNull();
    expect(await service.revoke(actor('u-cmd', 'commander'), id)).toMatchObject({
      status: 'ok',
    });
    expect(row(id)!.revokedAt).not.toBeNull();
  });

  it("answers an unknown id like someone else's token to those who can't revoke it", async () => {
    const { service, audit, created } = setup();
    const { id } = await created();
    const other = actor('u-other', 'officer');

    const unknown = await service.revoke(other, 999);
    const foreign = await service.revoke(other, id);

    expect(unknown).toEqual(foreign);
    expect(unknown).toEqual({ status: 'denied', requiredTier: 'commander' });
    expect(audit.slice(-2).map((e) => [e.action, e.result])).toEqual([
      ['mcp.token.revoke.any', 'denied'],
      ['mcp.token.revoke.any', 'denied'],
    ]);
  });

  it('tells a Comandante the id is unknown, and audits the refusal', async () => {
    const { service, audit } = setup();

    expect(await service.revoke(actor('u-cmd', 'commander'), 999)).toEqual({
      status: 'rejected',
      reason: ptBR.mcp.tokenNotFound(999),
    });
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'mcp.token.revoke.any',
        result: 'rejected',
        target: '#999',
      }),
    ]);
  });

  it('treats a token revoked twice as not found', async () => {
    const { service, created } = setup();
    const { id } = await created();
    await service.revoke(padrinho, id);

    expect(await service.revoke(padrinho, id)).toEqual({
      status: 'rejected',
      reason: ptBR.mcp.tokenNotFound(id),
    });
  });
});
