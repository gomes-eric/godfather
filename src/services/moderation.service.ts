import { refusedRequest, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { checkModerationTarget } from '../core/member-rules.js';
import { standingOf, standingTier } from '../core/standing.js';
import type { GuildDirectory } from '../discord/directory.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { GuildAdminPort, MemberView } from './guild-admin-port.js';

const t = ptBR.moderation;
const refusals = ptBR.members.refusals;

const MAX_TIMEOUT_MINUTES = 28 * 24 * 60; // Discord's limit
const MAX_PURGE = 100;
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // Discord's limit

interface Deps {
  guild: GuildAdminPort;
  directory: Pick<GuildDirectory, 'standingRoles'>;
  runAction: ActionRunner;
  now?: () => Date;
}

export class ModerationService {
  constructor(private readonly deps: Deps) {}

  private targetRefusal(
    actor: Actor,
    userId: string,
    member: MemberView | null,
    isBot: boolean,
  ): string | null {
    const { guild, directory } = this.deps;
    const isOwner = guild.ownerId() === userId;
    const refusal = checkModerationTarget({
      actorTier: actor.tier,
      actorId: actor.userId,
      targetId: userId,
      targetTier: member
        ? standingTier(standingOf(member.roleIds, directory.standingRoles(), isOwner))
        : 'visitor',
      targetIsBot: isBot,
      targetIsOwner: isOwner,
    });
    return refusal ? (refusals[refusal] ?? refusal) : null;
  }

  async kick(
    actor: Actor,
    userId: string,
    reason: string | null,
    confirm: boolean,
  ): Promise<ServiceOutcome<string>> {
    const why = reason ?? t.noReason;
    const member = await this.deps.guild.fetchMember(userId);
    if (!member) {
      return this.deps.runAction(
        refusedRequest(
          { actor, action: 'member.kick', target: userId, params: { userId, reason: why } },
          ptBR.members.notMember,
        ),
      );
    }

    const name = member.displayName;
    return this.deps.runAction({
      actor,
      action: 'member.kick',
      target: name,
      params: { userId, reason: why },
      confirm,
      preview: t.kickPreview(name, why),
      checkAfterAuthorization: () =>
        this.targetRefusal(actor, userId, member, member.bot) ??
        (member.kickable ? null : ptBR.members.botCannot),
      execute: async () => {
        await this.deps.guild.kick(userId, why);
        return t.kicked(name);
      },
    });
  }

  async ban(
    actor: Actor,
    userId: string,
    reason: string | null,
    deleteHours: number,
    confirm: boolean,
  ): Promise<ServiceOutcome<string>> {
    const why = reason ?? t.noReason;
    const params = { userId, reason: why, deleteMessageSeconds: deleteHours * 3600 };
    // Banning works for people who already left, so the member is optional.
    const member = await this.deps.guild.fetchMember(userId);
    const user = member ?? (await this.deps.guild.fetchUser(userId));
    if (!user) {
      return this.deps.runAction(
        refusedRequest(
          { actor, action: 'member.ban', target: userId, params },
          ptBR.members.notMember,
        ),
      );
    }

    const name = member?.displayName ?? user.username;
    return this.deps.runAction({
      actor,
      action: 'member.ban',
      target: name,
      params,
      confirm,
      preview: t.banPreview(name, why, deleteHours),
      checkAfterAuthorization: () =>
        this.targetRefusal(actor, userId, member, user.bot) ??
        (member && !member.bannable ? ptBR.members.botCannot : null),
      execute: async () => {
        await this.deps.guild.ban(userId, why, params.deleteMessageSeconds);
        return t.banned(name);
      },
    });
  }

  async unban(
    actor: Actor,
    userId: string,
    reason: string | null,
  ): Promise<ServiceOutcome<string>> {
    const why = reason ?? t.noReason;
    const banned = await this.deps.guild.fetchBan(userId);
    const name = banned?.username ?? userId;
    return this.deps.runAction({
      actor,
      action: 'member.unban',
      target: name,
      params: { userId, reason: why },
      preview: t.unbanned(name),
      checkAfterAuthorization: () => (banned ? null : t.notBanned),
      execute: async () => {
        await this.deps.guild.unban(userId, why);
        return t.unbanned(name);
      },
    });
  }

  async timeout(
    actor: Actor,
    userId: string,
    minutes: number,
    reason: string | null,
  ): Promise<ServiceOutcome<string>> {
    const capped = Math.min(Math.max(minutes, 0), MAX_TIMEOUT_MINUTES);
    const why = reason ?? t.noReason;
    const params = { userId, minutes: capped, reason: why };
    const member = await this.deps.guild.fetchMember(userId);
    if (!member) {
      return this.deps.runAction(
        refusedRequest(
          { actor, action: 'member.timeout', target: userId, params },
          ptBR.members.notMember,
        ),
      );
    }

    const name = member.displayName;
    const done = capped === 0 ? t.timeoutRemoved(name) : t.timedOut(name, capped);
    return this.deps.runAction({
      actor,
      action: 'member.timeout',
      target: name,
      params,
      preview: done,
      checkAfterAuthorization: () =>
        this.targetRefusal(actor, userId, member, member.bot) ??
        (member.moderatable ? null : ptBR.members.botCannot),
      execute: async () => {
        await this.deps.guild.timeout(userId, capped === 0 ? null : capped * 60_000, why);
        return done;
      },
    });
  }

  async purge(
    actor: Actor,
    channelId: string,
    count: number,
    authorId: string | null,
    confirm: boolean,
  ): Promise<ServiceOutcome<string>> {
    const { guild } = this.deps;
    const amount = Math.min(Math.max(count, 1), MAX_PURGE);
    const channel = await guild.fetchChannel(channelId);
    const author = authorId ? await guild.fetchMember(authorId) : null;
    const name = channel?.name ?? channelId;
    return this.deps.runAction({
      actor,
      action: 'message.purge',
      target: `#${name}`,
      params: { channelId, count: amount, ...(authorId && { authorId }) },
      confirm,
      preview: t.purgePreview(amount, name, author?.displayName),
      checkAfterAuthorization: () => (channel?.messageable ? null : t.notText),
      execute: async () => {
        const cutoff = (this.deps.now?.() ?? new Date()).getTime() - BULK_DELETE_MAX_AGE_MS;
        const ids = (await guild.newestMessages(channelId, MAX_PURGE))
          .filter((m) => !authorId || m.authorId === authorId)
          .slice(0, amount)
          .filter((m) => m.createdAt.getTime() > cutoff)
          .map((m) => m.id);
        return t.purged(await guild.bulkDelete(channelId, ids), name);
      },
    });
  }
}
