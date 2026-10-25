import type { Guild, GuildMember } from 'discord.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { checkModerationTarget } from '../core/member-rules.js';
import { memberTier } from '../discord/actor.js';
import type { GuildDirectory } from '../discord/directory.js';
import { ptBR } from '../i18n/pt-BR.js';

const t = ptBR.moderation;
const refusals = ptBR.members.refusals;

const MAX_TIMEOUT_MINUTES = 28 * 24 * 60; // Discord's limit
const MAX_PURGE = 100;

interface Deps {
  guild: Guild;
  directory: GuildDirectory;
  runAction: ActionRunner;
}

/** Kick, ban, unban, timeout and purge (PLAN.md §6.2). */
export class ModerationService {
  constructor(private readonly deps: Deps) {}

  /** Shared target checks; returns the reason to refuse, or null. */
  private refuse(actor: Actor, userId: string, member: GuildMember | null, isBot: boolean) {
    const refusal = checkModerationTarget({
      actorTier: actor.tier,
      actorId: actor.userId,
      targetId: userId,
      targetTier: member ? memberTier(member, this.deps.directory) : 'visitor',
      targetIsBot: isBot,
      targetIsOwner: this.deps.guild.ownerId === userId,
    });
    return refusal ? (refusals[refusal] ?? refusal) : null;
  }

  private fetchMember(userId: string) {
    return this.deps.guild.members.fetch(userId).catch(() => null);
  }

  async kick(
    actor: Actor,
    userId: string,
    reason: string | null,
    confirm: boolean,
  ): Promise<ServiceOutcome<string>> {
    const member = await this.fetchMember(userId);
    if (!member) return rejected(ptBR.members.notMember);
    const refusal = this.refuse(actor, userId, member, member.user.bot);
    if (refusal) return rejected(refusal);
    if (!member.kickable) return rejected(ptBR.members.botCannot);

    const why = reason ?? t.noReason;
    const name = member.displayName;
    return this.deps.runAction({
      actor,
      action: 'member.kick',
      target: name,
      params: { userId, reason: why },
      confirm,
      preview: t.kickPreview(name, why),
      execute: async () => {
        await member.kick(why);
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
    // Banning works for people who already left, so the member is optional.
    const member = await this.fetchMember(userId);
    const user =
      member?.user ?? (await this.deps.guild.client.users.fetch(userId).catch(() => null));
    if (!user) return rejected(ptBR.members.notMember);
    const refusal = this.refuse(actor, userId, member, user.bot);
    if (refusal) return rejected(refusal);
    if (member && !member.bannable) return rejected(ptBR.members.botCannot);

    const why = reason ?? t.noReason;
    const name = member?.displayName ?? user.username;
    return this.deps.runAction({
      actor,
      action: 'member.ban',
      target: name,
      params: { userId, reason: why, deleteMessageSeconds: deleteHours * 3600 },
      confirm,
      preview: t.banPreview(name, why, deleteHours),
      execute: async () => {
        await this.deps.guild.bans.create(userId, {
          reason: why,
          deleteMessageSeconds: deleteHours * 3600,
        });
        return t.banned(name);
      },
    });
  }

  async unban(
    actor: Actor,
    userId: string,
    reason: string | null,
  ): Promise<ServiceOutcome<string>> {
    const ban = await this.deps.guild.bans.fetch(userId).catch(() => null);
    if (!ban) return rejected(t.notBanned);

    const why = reason ?? t.noReason;
    return this.deps.runAction({
      actor,
      action: 'member.unban',
      target: ban.user.username,
      params: { userId, reason: why },
      preview: t.unbanned(ban.user.username),
      execute: async () => {
        await this.deps.guild.bans.remove(userId, why);
        return t.unbanned(ban.user.username);
      },
    });
  }

  /** `minutes` 0 removes the timeout. */
  async timeout(
    actor: Actor,
    userId: string,
    minutes: number,
    reason: string | null,
  ): Promise<ServiceOutcome<string>> {
    const member = await this.fetchMember(userId);
    if (!member) return rejected(ptBR.members.notMember);
    const refusal = this.refuse(actor, userId, member, member.user.bot);
    if (refusal) return rejected(refusal);
    if (!member.moderatable) return rejected(ptBR.members.botCannot);

    const capped = Math.min(Math.max(minutes, 0), MAX_TIMEOUT_MINUTES);
    const why = reason ?? t.noReason;
    const name = member.displayName;
    return this.deps.runAction({
      actor,
      action: 'member.timeout',
      target: name,
      params: { userId, minutes: capped, reason: why },
      preview: capped === 0 ? t.timeoutRemoved(name) : t.timedOut(name, capped),
      execute: async () => {
        await member.timeout(capped === 0 ? null : capped * 60_000, why);
        return capped === 0 ? t.timeoutRemoved(name) : t.timedOut(name, capped);
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
    const channel = await this.deps.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('bulkDelete' in channel)) return rejected(t.notText);

    const amount = Math.min(Math.max(count, 1), MAX_PURGE);
    const author = authorId ? await this.fetchMember(authorId) : null;
    return this.deps.runAction({
      actor,
      action: 'message.purge',
      target: `#${channel.name}`,
      params: { channelId, count: amount, ...(authorId && { authorId }) },
      confirm,
      preview: t.purgePreview(amount, channel.name, author?.displayName),
      execute: async () => {
        const recent = await channel.messages.fetch({ limit: MAX_PURGE });
        const targets = [...recent.values()]
          .filter((m) => !authorId || m.author.id === authorId)
          .slice(0, amount);
        // filterOld: Discord can't bulk-delete messages older than 14 days.
        const deleted = await channel.bulkDelete(targets, true);
        return t.purged(deleted.size, channel.name);
      },
    });
  }
}
