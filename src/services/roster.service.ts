import { classRoles } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { findAlliance } from '../core/alliances.js';
import { decideDemotion, decidePromotion } from '../core/member-rules.js';
import type { ActionName } from '../core/permissions.js';
import { NICKNAME_MAX, registrationNickname, rolesWithClass } from '../core/registration.js';
import {
  allyOf,
  decideStandingChange,
  ladderTier,
  PARTNER,
  RESTRICTED,
  restrictionOrigin,
  rolesForStanding,
  sameStanding,
  STANDING_ACTION,
  standingOf,
  standingTier,
  VISITOR,
  type Standing,
  type StandingCause,
} from '../core/standing.js';
import type { Tier } from '../core/tiers.js';
import type { RestrictionOrigin, RestrictionStore } from '../db/restrictions.js';
import type { GuildDirectory } from '../discord/directory.js';
import { notifyOfficers } from '../discord/officer-notices.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { MemberPort, MemberSnapshot } from './member-port.js';

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

export interface CharacterLook {
  classKey: string;
  gameName: string;
}

export interface StandingChange {
  to?: Standing;
  character?: CharacterLook;
  cause: StandingCause;
  action?: ActionName;
  confirm?: boolean;
  preview?: (name: string, from: string) => string;
  done?: (name: string) => string;
  already?: string;
}

export interface Changed {
  message: string;
  nickname: string | null;
}

interface Deps {
  members: MemberPort;
  directory: GuildDirectory;
  config: ConfigStore;
  restrictions: RestrictionStore;
  runAction: ActionRunner;
}

export class Roster {
  constructor(private readonly deps: Deps) {}

  private standingFrom(member: MemberSnapshot): Standing {
    return standingOf(member.roleIds, this.deps.directory.standingRoles(), member.isOwner);
  }

  async standingOf(userId: string): Promise<Standing | null> {
    const member = await this.deps.members.member(userId);
    return member && this.standingFrom(member);
  }

  async member(
    userId: string,
  ): Promise<{ displayName: string; avatarUrl: string; standing: Standing } | null> {
    const member = await this.deps.members.member(userId);
    return (
      member && {
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
        standing: this.standingFrom(member),
      }
    );
  }

  displayName(userId: string): string {
    return this.deps.members.cachedName(userId) ?? userId;
  }

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

  async check(actor: Actor, userId: string, to: Standing): Promise<string | null> {
    const member = await this.deps.members.member(userId);
    if (!member) return t.notMember;
    const refusal = this.refusal(actor, member, to);
    return refusal === 'alreadyThere' ? null : refusal;
  }

  private refusal(
    actor: Actor,
    member: MemberSnapshot,
    to: Standing,
  ): string | 'alreadyThere' | null {
    const refusal = decideStandingChange({
      actorTier: actor.tier,
      actorId: actor.userId,
      actorIsOwner: this.deps.members.ownerId() === actor.userId,
      targetId: member.id,
      targetIsBot: member.isBot,
      targetIsOwner: member.isOwner,
      from: this.standingFrom(member),
      to,
    });
    if (refusal && refusal !== 'alreadyThere') return t.refusals[refusal];
    if (!rolesForStanding(member.roleIds, to, this.deps.directory.standingRoles())) {
      return t.missingStandingRole(this.standingName(to));
    }
    if (!member.manageable) return t.botCannot;
    return refusal;
  }

  async change(
    actor: Actor,
    userId: string,
    change: StandingChange,
  ): Promise<ServiceOutcome<Changed>> {
    const member = await this.deps.members.member(userId);
    if (!member) return rejected(t.notMember);
    const name = member.displayName;
    const from = this.standingFrom(member);
    const to = change.to ?? from;
    const done = change.done ?? ((who: string) => t.changed(who, this.standingName(to)));

    if (change.to) {
      const refusal = this.refusal(actor, member, change.to);
      if (refusal === 'alreadyThere') {
        if (change.already) return rejected(change.already);
        if (!change.character)
          return { status: 'ok', value: { message: done(name), nickname: null } };
      } else if (refusal) {
        return rejected(refusal);
      }
    } else if (!member.manageable) {
      return rejected(t.botCannot);
    }

    let roleIds = rolesForStanding(member.roleIds, to, this.deps.directory.standingRoles());
    if (!roleIds) return rejected(t.missingStandingRole(this.standingName(to)));
    let nickname: string | null = null;
    if (change.character) {
      const look = this.characterRoles(roleIds, member, change.character);
      roleIds = look.roleIds;
      nickname = look.nickname;
    }

    const moved = change.to !== undefined && !sameStanding(from, to);
    if (moved) roleIds = this.withoutAllyLeader(roleIds);
    const fromName = this.standingName(from);
    const finalRoles = roleIds;
    return this.deps.runAction({
      actor,
      action: change.action ?? (moved ? STANDING_ACTION[to.kind] : 'member.sync'),
      target: name,
      params: { userId, from: fromName, to: this.standingName(to) },
      ...(change.confirm !== undefined && { confirm: change.confirm }),
      preview: change.preview
        ? change.preview(name, fromName)
        : t.changePreview(name, fromName, this.standingName(to)),
      execute: async () => {
        await this.deps.members.update(
          userId,
          { roleIds: finalRoles, ...(nickname !== null && { nickname }) },
          this.auditReason(change.cause),
        );
        if (change.to) this.recordRestriction(userId, to, change.cause, actor.userId);
        return { message: done(name), nickname };
      },
    });
  }

  private withoutAllyLeader(roleIds: string[]): string[] {
    const leaderId = this.deps.directory.allyLeaderRoleId();
    return leaderId ? roleIds.filter((id) => id !== leaderId) : roleIds;
  }

  private characterRoles(
    roleIds: string[],
    member: MemberSnapshot,
    character: CharacterLook,
  ): { roleIds: string[]; nickname: string | null } {
    const classRole = classRoles(this.deps.config.get()).find((r) => r.key === character.classKey);
    const classId = this.deps.directory.roleId(character.classKey);
    const withClass = classId
      ? rolesWithClass(roleIds, classId, this.deps.directory.classRoleIds())
      : roleIds;
    const nickname = registrationNickname(classRole?.emoji ?? '', character.gameName);
    const canRename = !member.isOwner && member.manageable && nickname.length <= NICKNAME_MAX;
    return { roleIds: withClass, nickname: canRename ? nickname : null };
  }

  private recordRestriction(userId: string, to: Standing, cause: StandingCause, by: string): void {
    if (to.kind !== 'restricted') {
      this.deps.restrictions.delete(userId);
      return;
    }
    this.deps.restrictions.set({
      userId,
      origin: restrictionOrigin(cause),
      reason: this.restrictionReason(cause),
      by,
    });
  }

  private restrictionReason(cause: StandingCause): string | null {
    switch (cause.kind) {
      case 'officer':
        return cause.reason;
      case 'transfer':
        return ptBR.registration.transferReason(cause.character);
      case 'allianceEnded':
        return ptBR.alliances.removedReason(cause.legion);
      default:
        return ptBR.legionCheck.restrictReason;
    }
  }

  private auditReason(cause: StandingCause): string {
    switch (cause.kind) {
      case 'officer':
        return t.officerReason;
      case 'recruitment':
        return ptBR.recruitment.approvedReason;
      case 'legionCheck':
        return ptBR.legionCheck.syncReason;
      case 'transfer':
        return ptBR.registration.transferReason(cause.character);
      case 'allianceEnded':
        return ptBR.alliances.removedReason(cause.legion);
    }
  }

  private async asText(outcome: Promise<ServiceOutcome<Changed>>): Promise<ServiceOutcome<string>> {
    const result = await outcome;
    return result.status === 'ok' ? { status: 'ok', value: result.value.message } : result;
  }

  promote(actor: Actor, userId: string, rank?: Tier): Promise<ServiceOutcome<string>> {
    return this.ladder('promote', actor, userId, rank, false);
  }

  demote(
    actor: Actor,
    userId: string,
    rank: Tier | undefined,
    confirm: boolean,
  ): Promise<ServiceOutcome<string>> {
    return this.ladder('demote', actor, userId, rank, confirm);
  }

  private async ladder(
    direction: 'promote' | 'demote',
    actor: Actor,
    userId: string,
    rank: Tier | undefined,
    confirm: boolean,
  ): Promise<ServiceOutcome<string>> {
    const member = await this.deps.members.member(userId);
    if (!member) return rejected(t.notMember);
    const roles = this.deps.directory.standingRoles();
    const officerRoleId = roles.tiers.officer;
    const maxOfficers = this.deps.config.get().roles.find((r) => r.tier === 'officer')?.maxMembers;
    const input = {
      actorTier: actor.tier,
      actorId: actor.userId,
      targetId: member.id,
      targetTier: ladderTier(this.standingFrom(member)),
      targetIsBot: member.isBot,
      targetIsOwner: member.isOwner,
      actorIsOwner: this.deps.members.ownerId() === actor.userId,
      officerCount: officerRoleId ? this.deps.members.roleMemberCount(officerRoleId) : 0,
      ...(rank !== undefined && { rank }),
      ...(maxOfficers !== undefined && { maxOfficers }),
    };
    const decision = direction === 'promote' ? decidePromotion(input) : decideDemotion(input);
    if (!decision.ok) return rejected(t.refusals[decision.refusal]);

    const { to } = decision;
    if (to !== 'visitor' && !roles.tiers[to]) return rejected(t.missingRole(ptBR.tier(to)));
    const target: Standing = to === 'visitor' ? VISITOR : { kind: 'tier', tier: to };
    return this.asText(
      this.change(actor, userId, {
        to: target,
        cause: { kind: 'officer', reason: null },
        action: direction === 'promote' ? 'member.promote' : 'member.demote',
        confirm,
        preview: (name, from) =>
          direction === 'promote'
            ? t.promotePreview(name, from, ptBR.tier(to))
            : t.demotePreview(name, from, ptBR.tier(to)),
        done: (name) =>
          direction === 'promote'
            ? t.promoted(name, ptBR.tier(to))
            : t.demoted(name, ptBR.tier(to)),
      }),
    );
  }

  async partner(actor: Actor, userId: string, remove: boolean): Promise<ServiceOutcome<string>> {
    if (!this.deps.directory.standingRoles().partner) return rejected(t.noPartnerRole);
    const cause: StandingCause = { kind: 'officer', reason: null };
    if (remove) {
      if ((await this.standingOf(userId))?.kind !== 'partner') {
        return rejected(t.refusals.notPartner);
      }
      return this.asText(
        this.change(actor, userId, {
          to: VISITOR,
          cause,
          action: 'member.partner',
          preview: (name) => t.unpartnered(name),
          done: t.unpartnered,
        }),
      );
    }
    return this.asText(
      this.change(actor, userId, {
        to: PARTNER,
        cause,
        preview: (name, from) => t.partnerPreview(name, from),
        done: t.partnered,
        already: t.refusals.alreadyPartner,
      }),
    );
  }

  async ally(actor: Actor, userId: string, legion: string): Promise<ServiceOutcome<string>> {
    const alliance = findAlliance(this.deps.config.get().alliances, legion);
    if (!alliance) return rejected(t.unknownAlliance(legion));
    if (!this.deps.directory.standingRoles().ally) return rejected(t.noAllyRole);
    return this.asText(
      this.change(actor, userId, {
        to: allyOf(alliance.key),
        cause: { kind: 'officer', reason: null },
        preview: (name, from) => t.allyPreview(name, from, alliance.legion),
        done: (name) => t.allied(name, alliance.legion),
        already: t.refusals.alreadyAlly,
      }),
    );
  }

  async setAllyLeader(
    actor: Actor,
    userId: string,
    leader: boolean,
  ): Promise<ServiceOutcome<string>> {
    const roleId = this.deps.directory.allyLeaderRoleId();
    if (!roleId) return rejected(t.noAllyLeaderRole);
    const member = await this.deps.members.member(userId);
    if (!member) return rejected(t.notMember);
    const standing = this.standingFrom(member);
    const legion = this.legionOf(standing);
    if (!legion) return rejected(t.notAlly);
    const isLeader = member.roleIds.includes(roleId);
    if (leader && isLeader) return rejected(t.alreadyLeader(legion));
    if (!leader && !isLeader) return rejected(t.notLeader);
    if (!member.manageable) return rejected(t.botCannot);

    const name = member.displayName;
    const roleIds = leader
      ? [...member.roleIds, roleId]
      : member.roleIds.filter((id) => id !== roleId);
    return this.deps.runAction({
      actor,
      action: 'alliance.leader',
      target: name,
      params: { userId, legion, leader },
      preview: leader ? t.leaderPreview(name, legion) : t.unleaderPreview(name, legion),
      execute: async () => {
        await this.deps.members.update(userId, { roleIds }, t.officerReason);
        return leader ? t.leaderSet(name, legion) : t.leaderUnset(name, legion);
      },
    });
  }

  async restrict(actor: Actor, userId: string, reason: string): Promise<ServiceOutcome<string>> {
    if (!this.deps.directory.standingRoles().restricted) return rejected(t.noRestrictedRole);
    let fromName = '';
    const outcome = await this.asText(
      this.change(actor, userId, {
        to: RESTRICTED,
        cause: { kind: 'officer', reason },
        preview: (name, from) => {
          fromName = from;
          return t.restrictPreview(name, from, reason);
        },
        done: t.restricted,
        already: t.refusals.alreadyRestricted,
      }),
    );
    if (outcome.status === 'ok') {
      await notifyOfficers(this.deps, t.restrictNotice(actor.userId, userId, fromName, reason));
    }
    return outcome;
  }

  async info(actor: Actor, userId: string): Promise<ServiceOutcome<MemberInfo>> {
    const member = await this.deps.members.member(userId);
    if (!member) return rejected(t.notMember);
    const standing = this.standingFrom(member);
    const classes = classRoles(this.deps.config.get()).filter((role) => {
      const id = this.deps.directory.roleId(role.key);
      return id !== undefined && member.roleIds.includes(id);
    });
    return this.deps.runAction({
      actor,
      action: 'member.read',
      preview: 'member.read',
      execute: async () => ({
        name: member.displayName,
        avatarUrl: member.avatarUrl,
        tier: standingTier(standing),
        standing: this.standingName(standing),
        classes: classes.map((role) => role.name),
        joinedAt: member.joinedAt,
        createdAt: member.createdAt,
        timeoutUntil: member.timeoutUntil,
      }),
    });
  }
}
