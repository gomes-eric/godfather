import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { refusedRequest, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import type { Db } from '../db/client.js';
import { mcpTokens } from '../db/schema.js';
import { ptBR } from '../i18n/pt-BR.js';

const PREFIX = 'pdr_';
export type TokenRow = typeof mcpTokens.$inferSelect;

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function revokeAction(
  actor: Actor,
  ownerId: string | undefined,
): 'mcp.token.revoke.own' | 'mcp.token.revoke.any' {
  return ownerId === actor.userId ? 'mcp.token.revoke.own' : 'mcp.token.revoke.any';
}

export class TokenService {
  constructor(
    private readonly db: Db,
    private readonly runAction: ActionRunner,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(actor: Actor, name: string): Promise<ServiceOutcome<{ token: string; id: number }>> {
    return this.runAction({
      actor,
      action: 'mcp.token.create',
      target: name,
      params: { name },
      preview: name,
      execute: async () => {
        const token = `${PREFIX}${randomBytes(32).toString('base64url')}`;
        const row = this.db
          .insert(mcpTokens)
          .values({ userId: actor.userId, name, tokenHash: hash(token) })
          .returning({ id: mcpTokens.id })
          .get();
        return { token, id: row.id };
      },
    });
  }

  list(userId: string): TokenRow[] {
    return this.db
      .select()
      .from(mcpTokens)
      .where(and(eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt)))
      .orderBy(desc(mcpTokens.id))
      .all();
  }

  async revoke(actor: Actor, id: number): Promise<ServiceOutcome<string>> {
    const row = this.db.select().from(mcpTokens).where(eq(mcpTokens.id, id)).get();
    const action = revokeAction(actor, row?.userId);
    if (!row || row.revokedAt) {
      return this.runAction(
        refusedRequest(
          { actor, action, target: `#${id}`, params: { id } },
          ptBR.mcp.tokenNotFound(id),
        ),
      );
    }
    return this.runAction({
      actor,
      action,
      target: `${row.name} (#${row.id})`,
      params: { id, owner: row.userId },
      preview: row.name,
      execute: async () => {
        this.db.update(mcpTokens).set({ revokedAt: this.now() }).where(eq(mcpTokens.id, id)).run();
        return ptBR.mcp.revoked(row.name);
      },
    });
  }

  verify(token: string): { userId: string; tokenId: number } | null {
    if (!token.startsWith(PREFIX)) return null;
    const digest = hash(token);
    const row = this.db.select().from(mcpTokens).where(eq(mcpTokens.tokenHash, digest)).get();
    if (!row || row.revokedAt) return null;
    this.db.update(mcpTokens).set({ lastUsedAt: this.now() }).where(eq(mcpTokens.id, row.id)).run();
    return { userId: row.userId, tokenId: row.id };
  }
}
