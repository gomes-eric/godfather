import type { Guild, GuildMember } from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import {
  decideDemotion,
  decidePartner,
  decidePromotion,
  rolesForPartner,
  rolesForTier,
} from '../core/member-rules.js';
import type { Tier } from '../core/tiers.js';
import { memberTier } from '../discord/actor.js';
import type { GuildDirectory } from '../discord/directory.js';
import { ptBR } from '../i18n/pt-BR.js';

const t = ptBR.members;

export interface MemberInfo {
  name: string;
  avatarUrl: string;
  tier: Tier;
  classes: string[];
  joinedAt: Date | null;
  createdAt: Date;
  timeoutUntil: Date | null;
}

interface Deps {
  guild: Guild;
  directory: GuildDirectory;
  config: ConfigStore;
  runAction: ActionRunner;
}

/** Promotion, demotion and member info (PLAN.md §6.8). */
export class MemberService {
  constructor(private readonly deps: Deps) {}

  /** Role id per tier, Visitante included. */
  private tierRoles(): Partial<Record<Tier, string>> {
    const visitorKey = this.deps.config.get().roles.find((r) => r.tier === 'visitor')?.key;
    const visitorId = visitorKey ? this.deps.directory.roleId(visitorKey) : undefined;
    return { ...this.deps.directory.tierRoleIds(), ...(visitorId && { visitor: visitorId }) };
  }

  private async fetchMember(userId: string): Promise<GuildMember | null> {
    return this.deps.guild.members.fetch(userId).catch(() => null);
  }

  promote(actor: Actor, userId: string, rank?: Tier): Promise<ServiceOutcome<string>> {
    return this.changeTier('promote', actor, userId, rank, false);
  }

  demote(
    actor: Actor,
    userId: string,
    rank: Tier | undefined,
    confirm: boolean,
  ): Promise<ServiceOutcome<string>> {
    return this.changeTier('demote', actor, userId, rank, confirm);
  }

  private async changeTier(
    direction: 'promote' | 'demote',
    actor: Actor,
    userId: string,
    rank: Tier | undefined,
    confirm: boolean,
  ): Promise<ServiceOutcome<string>> {
    const { guild, directory, config, runAction } = this.deps;
    const member = await this.fetchMember(userId);
    if (!member) return rejected(t.notMember);

    const tierRoles = this.tierRoles();
    const officerRoleId = tierRoles.officer;
    // Counted from the member cache, which the GuildMembers intent keeps current and the
    // startup role sync fills. A full member fetch here would hit the gateway rate limit
    // (one per ~30s) when promoting several people in a row.
    const officerCount = officerRoleId
      ? (guild.roles.cache.get(officerRoleId)?.members.size ?? 0)
      : 0;
    const maxOfficers = config.get().roles.find((r) => r.tier === 'officer')?.maxMembers;

    const from = memberTier(member, directory);
    const input = {
      actorTier: actor.tier,
      actorId: actor.userId,
      targetId: member.id,
      targetTier: from,
      targetIsBot: member.user.bot,
      targetIsOwner: guild.ownerId === member.id,
      officerCount,
      ...(rank !== undefined && { rank }),
      ...(maxOfficers !== undefined && { maxOfficers }),
    };
    const decision = direction === 'promote' ? decidePromotion(input) : decideDemotion(input);
    if (!decision.ok) return rejected(t.refusals[decision.refusal] ?? decision.refusal);

    const { to } = decision;
    if (!tierRoles[to]) return rejected(t.missingRole(ptBR.tier(to)));
    if (!member.manageable) return rejected(t.botCannot);

    const name = member.displayName;
    const preview =
      direction === 'promote'
        ? t.promotePreview(name, ptBR.tier(from), ptBR.tier(to))
        : t.demotePreview(name, ptBR.tier(from), ptBR.tier(to));

    return runAction({
      actor,
      action: direction === 'promote' ? 'member.promote' : 'member.demote',
      target: name,
      params: { userId: member.id, from, to },
      confirm,
      preview,
      execute: async () => {
        // Joining the legion ends a partnership: Parceiro is for people who don't play.
        const partnerId = this.partnerRoleId();
        const current = [...member.roles.cache.keys()].filter(
          (id) => id !== guild.id && !(to !== 'visitor' && id === partnerId),
        );
        await member.roles.set(rolesForTier(current, to, tierRoles));
        return direction === 'promote'
          ? t.promoted(name, ptBR.tier(to))
          : t.demoted(name, ptBR.tier(to));
      },
    });
  }

  private partnerRoleId(): string | undefined {
    const key = this.deps.config.get().settings.partnerRole;
    return key ? this.deps.directory.roleId(key) : undefined;
  }

  /** Gives Parceiro to someone who doesn't play (in place of Visitante), or takes it back. */
  async partner(actor: Actor, userId: string, remove: boolean): Promise<ServiceOutcome<string>> {
    const { guild, directory, runAction } = this.deps;
    const partnerId = this.partnerRoleId();
    if (!partnerId) return rejected(t.noPartnerRole);
    const member = await this.fetchMember(userId);
    if (!member) return rejected(t.notMember);

    const refusal = decidePartner({
      actorId: actor.userId,
      targetId: member.id,
      targetIsBot: member.user.bot,
      targetIsOwner: guild.ownerId === member.id,
      targetTier: memberTier(member, directory),
      isPartner: member.roles.cache.has(partnerId),
      remove,
    });
    if (refusal) return rejected(t.refusals[refusal] ?? refusal);
    if (!member.manageable) return rejected(t.botCannot);

    const name = member.displayName;
    return runAction({
      actor,
      action: 'member.partner',
      target: name,
      params: { userId: member.id, remove },
      preview: remove ? t.unpartnered(name) : t.partnered(name),
      execute: async () => {
        const current = [...member.roles.cache.keys()].filter((id) => id !== guild.id);
        await member.roles.set(
          rolesForPartner(current, partnerId, this.tierRoles().visitor, remove),
        );
        return remove ? t.unpartnered(name) : t.partnered(name);
      },
    });
  }

  async info(actor: Actor, userId: string): Promise<ServiceOutcome<MemberInfo>> {
    const member = await this.fetchMember(userId);
    if (!member) return rejected(t.notMember);

    const classes = this.deps.config
      .get()
      .roles.filter((role) => role.class)
      .filter((role) => {
        const id = this.deps.directory.roleId(role.key);
        return id !== undefined && member.roles.cache.has(id);
      })
      .map((role) => role.name);

    return this.deps.runAction({
      actor,
      action: 'member.read',
      preview: 'member.read',
      execute: async () => ({
        name: member.displayName,
        avatarUrl: member.displayAvatarURL(),
        tier: memberTier(member, this.deps.directory),
        classes,
        joinedAt: member.joinedAt,
        createdAt: member.user.createdAt,
        timeoutUntil: member.isCommunicationDisabled() ? member.communicationDisabledUntil : null,
      }),
    });
  }
}
