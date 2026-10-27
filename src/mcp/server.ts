import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Actor } from '../core/actor.js';
import type { Logger } from '../logger.js';
import type { TokenService } from '../services/token.service.js';
import { buildInstructions } from './instructions.js';
import { RateLimiter } from '../core/rate-limit.js';
import { registerTools, type McpServices } from './tools.js';

const CALLS_PER_MINUTE = 60;

export interface McpDeps {
  tokens: Pick<TokenService, 'verify'>;
  resolveActor(userId: string, harness: string | undefined): Promise<Actor>;
  services: McpServices;
  logger: Logger;
  version: string;
}

function jsonError(status: number, message: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** "claude-code/2.1.0 (...)" → "claude-code"; an explicit X-Harness header wins. */
export function harnessName(headers: Headers): string | undefined {
  const explicit = headers.get('x-harness')?.trim();
  if (explicit) return explicit.slice(0, 50);
  const product = headers.get('user-agent')?.split(/[\s/]/)[0]?.trim();
  return product ? product.toLowerCase().slice(0, 50) : undefined;
}

/**
 * Stateless Streamable HTTP endpoint (PLAN.md §8.1): every request is authenticated with a
 * personal Bearer token, rate-limited per token, and served by a fresh MCP server whose tools act
 * as the token owner with their current Discord roles.
 */
export function createMcpHandler(deps: McpDeps): (request: Request) => Promise<Response> {
  const limiter = new RateLimiter(CALLS_PER_MINUTE, 60_000);

  return async (request) => {
    // Stateless: there is no server-to-client stream to open. Without a 405, clients reopen the
    // GET stream every second, which eats the token's rate limit and blocks real calls.
    if (request.method !== 'POST') {
      return jsonError(405, 'Only POST is supported.', { Allow: 'POST' });
    }

    const header = request.headers.get('authorization') ?? '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const owner = token ? deps.tokens.verify(token) : null;
    if (!owner) {
      return jsonError(401, 'Missing or invalid token. Create one with /mcp token create.', {
        'WWW-Authenticate': 'Bearer realm="padrinho"',
      });
    }
    if (!limiter.take(String(owner.tokenId))) {
      return jsonError(429, `Rate limit: ${CALLS_PER_MINUTE} calls per minute.`, {
        'Retry-After': '60',
      });
    }

    const actor = await deps.resolveActor(owner.userId, harnessName(request.headers));
    const server = new McpServer(
      { name: 'padrinho', version: deps.version },
      { instructions: buildInstructions(deps.services.config.get()) },
    );
    registerTools(server, deps.services, actor);

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } catch (error) {
      deps.logger.error({ err: error, user: owner.userId }, 'MCP request failed');
      return jsonError(500, 'Internal error');
    } finally {
      void server.close();
    }
  };
}
