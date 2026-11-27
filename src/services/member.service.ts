import type { Guild, GuildMember } from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { decideDemotion, decidePromotion } from '../core/member-rules.js';
import type { ActionName } from '../core/permissions.js';
import {
  allyOf,
  decideStandingChange,
  ladderTier,
  PARTNER,
  RESTRICTED,
  rolesForStanding,
  VISITOR,
  type Standing,
} from '../core/standing.js';
import type { Tier } from '../core/tiers.js';
import type { RestrictionOrigin, RestrictionStore } from '../db/restrictions.js';
import type { GuildDirectory } from '../discord/directory.js';
import { fetchMember, memberRoleIds, memberStanding, memberTier } from '../discord/members.js';
import { notifyOfficers } from '../discord/officer-notices.js';
import { ptBR } from '../i18n/pt-BR.js';

const t = ptBR.members;

export interface MemberInfo {
  name: string;
  avatarUrl: string;
  tier: Tier;
  standing: string;
  classes: string[];
  joinedAt: Date | null;
  createdAt: Date;
  timeoutUntil: Date | null;
}

interface Deps {
  guild: Guild;
  directory: GuildDirectory;
  config: ConfigStore;
  restrictions: RestrictionStore;
  runAction: ActionRunner;
}

export interface RestrictionCause {
  origin: RestrictionOrigin;
  reason: string | null;
}

export class MemberService {
  constructor(private readonly deps: Deps) {}

  legionOf(standing: Standing): string | undefined {
    return standing.kind === 'ally'
      ? this.deps.config.get().alliances.find((a) => a.key === standing.allianceKey)?.legion
      : undefined;
  }

  standingName(standing: Standing): string {
    return ptBR.standing(standing, this.legionOf(standing));
  }

  restrictionOf(userId: string): RestrictionOrigin | undefined {
    return this.deps.restrictions.get(userId)?.origin;
  }

  standingOf(member: GuildMember): Standing {
    return memberStanding(member, this.deps.directory);
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
    const { guild, directory, config } = this.deps;
    const member = await fetchMember(guild, userId);
    if (!member) return rejected(t.notMember);

    const roles = directory.standingRoles();
    const officerRoleId = roles.tiers.officer;
    // Counted from the member cache, which the GuildMembers intent keeps current and the
    // startup role sync fills. A full member fetch here would hit the gateway rate limit
    // (one per ~30s) when promoting several people in a row.
    const officerCount = officerRoleId
      ? (guild.roles.cache.get(officerRoleId)?.members.size ?? 0)
      : 0;
    const maxOfficers = config.get().roles.find((r) => r.tier === 'officer')?.maxMembers;

    const standing = memberStanding(member, directory, roles);
    const from = ladderTier(standing);
    const input = {
      actorTier: actor.tier,
      actorId: actor.userId,
      targetId: member.id,
      targetTier: from,
      targetIsBot: member.user.bot,
      targetIsOwner: guild.ownerId === member.id,
      actorIsOwner: guild.ownerId === actor.userId,
      officerCount,
      ...(rank !== undefined && { rank }),
      ...(maxOfficers !== undefined && { maxOfficers }),
    };
    const decision = direction === 'promote' ? decidePromotion(input) : decideDemotion(input);
    if (!decision.ok) return rejected(t.refusals[decision.refusal] ?? decision.refusal);

    const { to } = decision;
    const target: Standing = to === 'visitor' ? VISITOR : { kind: 'tier', tier: to };
    if (to !== 'visitor' && !roles.tiers[to]) return rejected(t.missingRole(ptBR.tier(to)));
    if (!member.manageable) return rejected(t.botCannot);

    const name = member.displayName;
    const fromName = this.standingName(standing);
    return this.deps.runAction({
      actor,
      action: direction === 'promote' ? 'member.promote' : 'member.demote',
      target: name,
      params: { userId: member.id, from: fromName, to },
      confirm,
      preview:
        direction === 'promote'
          ? t.promotePreview(name, fromName, ptBR.tier(to))
          : t.demotePreview(name, fromName, ptBR.tier(to)),
      execute: async () => {
        await this.applyStanding(member, target, actor.userId);
        return direction === 'promote'
          ? t.promoted(name, ptBR.tier(to))
          : t.demoted(name, ptBR.tier(to));
      },
    });
  }

  async partner(actor: Actor, userId: string, remove: boolean): Promise<ServiceOutcome<string>> {
    if (!this.deps.directory.standingRoles().partner) return rejected(t.noPartnerRole);
    if (remove) {
      const member = await fetchMember(this.deps.guild, userId);
      if (!member) return rejected(t.notMember);
      if (this.standingOf(member).kind !== 'partner') return rejected(t.refusals.notPartner!);
      return this.move(actor, userId, VISITOR, {
        action: 'member.partner',
        preview: t.unpartnered(member.displayName),
        done: t.unpartnered,
      });
    }
    return this.move(actor, userId, PARTNER, {
      action: 'member.partner',
      preview: (name, from) => t.partnerPreview(name, from),
      done: t.partnered,
      already: t.refusals.alreadyPartner!,
    });
  }

  async ally(actor: Actor, userId: string, allianceKey: string): Promise<ServiceOutcome<string>> {
    const alliance = this.deps.config.get().alliances.find((a) => a.key === allianceKey);
    if (!alliance) return rejected(t.unknownAlliance(allianceKey));
    if (!this.deps.directory.standingRoles().ally) return rejected(t.noAllyRole);
    return this.move(actor, userId, allyOf(alliance.key), {
      action: 'member.ally',
      preview: (name, from) => t.allyPreview(name, from, alliance.legion),
      done: (name) => t.allied(name, alliance.legion),
      already: t.refusals.alreadyAlly!,
    });
  }

  async restrict(actor: Actor, userId: string, reason: string): Promise<ServiceOutcome<string>> {
    if (!this.deps.directory.standingRoles().restricted) return rejected(t.noRestrictedRole);
    let fromName = '';
    const outcome = await this.move(actor, userId, RESTRICTED, {
      action: 'member.restrict',
      preview: (name, from) => {
        fromName = from;
        return t.restrictPreview(name, from, reason);
      },
      done: t.restricted,
      already: t.refusals.alreadyRestricted!,
      restriction: { origin: 'manual', reason },
    });
    if (outcome.status === 'ok') {
      await notifyOfficers(this.deps, t.restrictNotice(actor.userId, userId, fromName, reason));
    }
    return outcome;
  }

  refusalFor(actor: Actor, member: GuildMember, to: Standing): string | null {
    const refusal = decideStandingChange({
      actorTier: actor.tier,
      actorId: actor.userId,
      actorIsOwner: this.deps.guild.ownerId === actor.userId,
      targetId: member.id,
      targetIsBot: member.user.bot,
      targetIsOwner: this.deps.guild.ownerId === member.id,
      from: this.standingOf(member),
      to,
    });
    if (!refusal || refusal === 'alreadyThere') {
      if (!rolesForStanding(memberRoleIds(member), to, this.deps.directory.standingRoles())) {
        return t.missingStandingRole(this.standingName(to));
      }
      return member.manageable ? null : t.botCannot;
    }
    return t.refusals[refusal] ?? refusal;
  }

  async move(
    actor: Actor,
    userId: string,
    to: Standing,
    how: {
      action: ActionName;
      preview: string | ((name: string, from: string) => string);
      done: (name: string) => string;
      already?: string;
      restriction?: RestrictionCause;
    },
  ): Promise<ServiceOutcome<string>> {
    const { guild } = this.deps;
    const member = await fetchMember(guild, userId);
    if (!member) return rejected(t.notMember);

    const from = this.standingOf(member);
    const refusal = decideStandingChange({
      actorTier: actor.tier,
      actorId: actor.userId,
      actorIsOwner: guild.ownerId === actor.userId,
      targetId: member.id,
      targetIsBot: member.user.bot,
      targetIsOwner: guild.ownerId === member.id,
      from,
      to,
    });
    const name = member.displayName;
    if (refusal === 'alreadyThere' && !how.already) return { status: 'ok', value: how.done(name) };
    if (refusal) {
      return rejected(refusal === 'alreadyThere' ? how.already! : (t.refusals[refusal] ?? refusal));
    }
    if (!rolesForStanding(memberRoleIds(member), to, this.deps.directory.standingRoles())) {
      return rejected(t.missingStandingRole(this.standingName(to)));
    }
    if (!member.manageable) return rejected(t.botCannot);

    const fromName = this.standingName(from);
    return this.deps.runAction({
      actor,
      action: how.action,
      target: name,
      params: { userId: member.id, from: fromName, to: this.standingName(to) },
      preview: typeof how.preview === 'string' ? how.preview : how.preview(name, fromName),
      execute: async () => {
        await this.applyStanding(member, to, actor.userId, how.restriction);
        return how.done(name);
      },
    });
  }

  private async applyStanding(
    member: GuildMember,
    to: Standing,
    byUserId: string,
    restriction: RestrictionCause = { origin: 'manual', reason: null },
  ): Promise<void> {
    const roles = rolesForStanding(memberRoleIds(member), to, this.deps.directory.standingRoles());
    if (!roles) throw new Error(`a role for ${this.standingName(to)} is missing`);
    await member.roles.set(roles);
    if (to.kind === 'restricted') {
      this.deps.restrictions.set({ userId: member.id, ...restriction, by: byUserId });
    } else {
      this.deps.restrictions.delete(member.id);
    }
  }

  async info(actor: Actor, userId: string): Promise<ServiceOutcome<MemberInfo>> {
    const member = await fetchMember(this.deps.guild, userId);
    if (!member) return rejected(t.notMember);

    return this.deps.runAction({
      actor,
      action: 'member.read',
      preview: 'member.read',
      execute: async () => ({
        name: member.displayName,
        avatarUrl: member.displayAvatarURL(),
        tier: memberTier(member, this.deps.directory),
        standing: this.standingName(this.standingOf(member)),
        classes: this.deps.directory.classesOf(member).map((role) => role.name),
        joinedAt: member.joinedAt,
        createdAt: member.user.createdAt,
        timeoutUntil: member.isCommunicationDisabled() ? member.communicationDisabledUntil : null,
      }),
    });
  }
}
