import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { pino } from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../config/store.js';
import { createActionRunner } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import type { AuditEntry } from '../core/audit.js';
import type { Tier } from '../core/tiers.js';
import { harnessName, createMcpHandler } from './server.js';
import type { McpServices } from './tools.js';

const repoServerYaml = fileURLToPath(new URL('../../server.yaml', import.meta.url));
const TOKEN = 'pdr_valid';

describe('MCP endpoint', () => {
  let config: ConfigStore;
  let path: string;
  let audit: AuditEntry[];
  let tier: Tier;
  let handler: (request: Request) => Promise<Response>;

  beforeEach(() => {
    path = join(mkdtempSync(join(tmpdir(), 'padrinho-')), 'server.yaml');
    copyFileSync(repoServerYaml, path);
    config = new ConfigStore(path);
    audit = [];
    tier = 'commander';
    const runAction = createActionRunner({
      record: async (entry) => {
        audit.push(entry);
        return { ...entry, id: audit.length, at: new Date() };
      },
    });
    // Only the pieces these tools touch; the rest needs a live Discord guild.
    const services = { config, runAction, messageContent: false } as unknown as McpServices;
    handler = createMcpHandler({
      tokens: { verify: (token) => (token === TOKEN ? { userId: 'padrinho', tokenId: 1 } : null) },
      resolveActor: async (userId, harness): Promise<Actor> => ({
        userId,
        tier,
        source: 'mcp',
        ...(harness && { harness }),
      }),
      services,
      logger: pino({ level: 'silent' }),
      version: 'test',
    });
  });

  async function connect(token = TOKEN) {
    const client = new Client({ name: 'vitest', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('http://padrinho.test/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${token}`, 'X-Harness': 'vitest' } },
      fetch: async (input, init) => handler(new Request(input, init)),
    });
    await client.connect(transport);
    return client;
  }

  const textOf = (result: Awaited<ReturnType<Client['callTool']>>) =>
    (result.content as { type: string; text: string }[])[0]!.text;

  it('rejects requests without a valid token', async () => {
    const response = await handler(
      new Request('http://padrinho.test/mcp', { method: 'POST', body: '{}' }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
    await expect(connect('pdr_wrong')).rejects.toThrow();
  });

  it('lists the tools and sends the legion context as instructions', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'create_event',
        'ban_member',
        'send_message',
        'apply_server_config',
        'set_boss_respawn',
        'upsert_voice_generator',
      ]),
    );
    expect(client.getInstructions()).toContain('M4F1A');
    expect(client.getInstructions()).toContain('confirm: true');
  });

  it('runs a tool as the token owner and audits it with the harness name', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'upsert_voice_generator',
      arguments: {
        key: 'gen-raid',
        category: 'voice-rooms',
        name: '➕ Raid',
        nameTemplate: 'Raid {n}',
        userLimit: 8,
      },
    });

    expect(result.isError).toBeFalsy();
    expect(readFileSync(path, 'utf8')).toContain('gen-raid');
    expect(audit[0]).toMatchObject({
      action: 'voice.generator.upsert',
      result: 'ok',
      actor: { userId: 'padrinho', source: 'mcp', harness: 'vitest' },
    });
  });

  it('returns a preview for destructive tools until confirm is true', async () => {
    const client = await connect();
    const first = await client.callTool({
      name: 'delete_voice_generator',
      arguments: { key: 'gen-social' },
    });
    expect(JSON.parse(textOf(first))).toMatchObject({ status: 'confirmation_required' });
    expect(config.get().voiceGenerators.some((g) => g.key === 'gen-social')).toBe(true);

    const second = await client.callTool({
      name: 'delete_voice_generator',
      arguments: { key: 'gen-social', confirm: true },
    });
    expect(second.isError).toBeFalsy();
    expect(config.get().voiceGenerators.some((g) => g.key === 'gen-social')).toBe(false);
  });

  it('denies tools above the owner’s current tier', async () => {
    tier = 'soldier';
    const client = await connect();
    const result = await client.callTool({
      name: 'upsert_voice_generator',
      arguments: {
        key: 'gen-raid',
        category: 'voice-rooms',
        name: '➕ Raid',
        nameTemplate: 'Raid {n}',
        userLimit: 8,
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Comandante');
  });

  it('limits each token to 60 calls per minute', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const response = await handler(
        new Request('http://padrinho.test/mcp', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: i, method: 'ping' }),
        }),
      );
      statuses.push(response.status);
    }
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.slice(0, 60).every((s) => s !== 429)).toBe(true);
  });
});

describe('harnessName', () => {
  it('prefers X-Harness and falls back to the user agent product', () => {
    expect(harnessName(new Headers({ 'x-harness': 'codex' }))).toBe('codex');
    expect(harnessName(new Headers({ 'user-agent': 'claude-code/2.1.0 (cli)' }))).toBe(
      'claude-code',
    );
    expect(harnessName(new Headers())).toBeUndefined();
  });
});
