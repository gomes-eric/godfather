import { EmbedBuilder, type Guild, type GuildMember } from 'discord.js';
import { classRoles, type RoleConfig } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import type { ActionRunner } from '../core/action.js';
import { systemActor } from '../core/actor.js';
import { matchClass } from '../core/game-character.js';
import {
  characterChanges,
  checkDue,
  legionTransition,
  departuresLookTrustworthy,
  MAX_DEPARTURES,
  type Transition,
} from '../core/legion-check.js';
import type { CharacterProfile } from '../core/game-character.js';
import { encodeStanding, type Standing } from '../core/standing.js';
import type { ActionName } from '../core/permissions.js';
import { registrationNickname } from '../core/registration.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import type { CharacterSnapshot, CharacterStore, RegisteredCharacter } from '../db/characters.js';
import type { RestrictionStore } from '../db/restrictions.js';
import { applyCharacter } from '../discord/character-registration.js';
import { COLORS } from '../discord/colors.js';
import type { GuildDirectory } from '../discord/directory.js';
import { fetchMember, memberStanding } from '../discord/members.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import type { GameCharacterService } from './game-character.service.js';
import type { MemberService } from './member.service.js';
import type { RankingBoard } from './ranking-board.service.js';
import type { ReviewInput } from './recruitment.service.js';

const t = ptBR.legionCheck;
const TICK_MS = 60 * 60_000;
const PAUSE_MS = 1_500;

interface Deps {
  guild: Guild;
  config: ConfigStore;
  directory: GuildDirectory;
  ranking: RankingBoard;
  registrations: CharacterStore;
  characters: GameCharacterService;
  runAction: ActionRunner;
  members: MemberService;
  restrictions: RestrictionStore;
  review: (input: ReviewInput) => Promise<void>;
  logger: Logger;
  pause?: (ms: number) => Promise<void>;
}

interface Checked {
  userId: string;
  lines: string[];
  snapshot: CharacterSnapshot;
  legionBefore: string;
  move?: {
    member: GuildMember;
    from: Standing;
    transition: Transition;
    character: CharacterProfile;
  };
}

const MOVE_ACTION: Record<Standing['kind'], ActionName> = {
  tier: 'member.promote',
  ally: 'member.ally',
  partner: 'member.partner',
  restricted: 'member.restrict',
  visitor: 'member.demote',
};

export class LegionCheckService implements BackgroundJob {
  private running = false;
  private readonly pause: (ms: number) => Promise<void>;

  constructor(private readonly deps: Deps) {
    this.pause = deps.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private classRole(key: string): RoleConfig | undefined {
    return classRoles(this.deps.config.get()).find((role) => role.key === key);
  }

  async runIfDue(now = new Date()): Promise<string[]> {
    const checkedAt = this.deps.registrations.all().map((row) => row.checkedAt);
    return checkDue(checkedAt, now) ? this.check() : [];
  }

  get isChecking(): boolean {
    return this.running;
  }

  async check(): Promise<string[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const checked: Checked[] = [];
      for (const row of this.deps.registrations.all()) {
        const result = await this.checkOne(row).catch((error: unknown) => {
          this.deps.logger.warn({ err: error, user: row.userId }, 'legion check failed for member');
          return undefined;
        });
        if (result) checked.push(result);
        await this.pause(PAUSE_MS);
      }
      const report = await this.applyMoves(checked);
      await this.postReport(report);
      await this.deps.ranking.refresh();
      this.deps.logger.info({ changes: report.length }, 'legion check done');
      return report;
    } finally {
      this.running = false;
    }
  }

  private async checkOne(row: RegisteredCharacter): Promise<Checked | undefined> {
    const { guild, characters, config } = this.deps;
    const member = await fetchMember(guild, row.userId);
    if (!member) return undefined;

    const profile = await characters.profile({ id: row.characterId, serverId: row.serverId }, true);
    const classRole = matchClass(profile.className, classRoles(config.get()));
    const legion = config.get().settings.characters.legion;
    const now = {
      name: profile.name,
      classKey: classRole?.key ?? row.classKey,
      legion: profile.legion,
    };
    const changes = characterChanges(row, now, legion);
    const firstCheckSetsBaseline = !row.checkedAt;
    if (firstCheckSetsBaseline) {
      changes.leftLegion = false;
      changes.joinedLegion = false;
    }
    const lines: string[] = [];

    if (changes.renamed || changes.classChanged) {
      await this.syncMember(member, now.name, now.classKey);
      if (changes.renamed) {
        lines.push(t.renamed(member.id, changes.renamed.from, changes.renamed.to));
      }
      if (changes.classChanged) {
        const name = (key: string) => this.classRole(key)?.name ?? key;
        lines.push(
          t.classChanged(member.id, name(changes.classChanged.from), name(changes.classChanged.to)),
        );
      }
    }

    const snapshot = { ...now, combatPower: profile.combatPower, itemLevel: profile.itemLevel };
    const from = memberStanding(member, this.deps.directory);
    const transition = !firstCheckSetsBaseline
      ? legionTransition({
          standing: from,
          before: row.legion,
          now: profile.legion,
          legion,
          alliances: config.get().alliances,
          restrictedBy: this.deps.restrictions.get(member.id)?.origin,
        })
      : null;
    if (!transition) {
      if (changes.leftLegion) lines.push(t.left(member.id, now.name, legion, now.legion));
      if (changes.joinedLegion) lines.push(t.joined(member.id, now.name, legion));
    }
    return {
      userId: member.id,
      lines,
      snapshot,
      legionBefore: row.legion,
      ...(transition && { move: { member, from, transition, character: profile } }),
    };
  }

  private async applyMoves(checked: Checked[]): Promise<string[]> {
    const report = checked.flatMap((c) => c.lines);
    const departures = checked.filter((c) => c.move?.transition.departure).length;
    const holdBack = !departuresLookTrustworthy(departures);
    if (holdBack) report.push(t.tooManyDepartures(departures, MAX_DEPARTURES));

    for (const c of checked) {
      if (c.move && holdBack) {
        report.push(t.heldBack(c.userId, c.snapshot.name, c.snapshot.legion));
      } else if (c.move) {
        report.push(...(await this.carryOut(c.move)));
      }
      const legion = c.move && holdBack ? c.legionBefore : c.snapshot.legion;
      this.deps.registrations.updateSnapshot(c.userId, { ...c.snapshot, legion });
    }
    return report;
  }

  private async carryOut(move: NonNullable<Checked['move']>): Promise<string[]> {
    const { member, from, transition, character } = move;
    const bot = systemActor(this.deps.guild.client.user.id);
    const { members } = this.deps;
    const fromName = members.standingName(from);
    const legion = this.deps.config.get().settings.characters.legion;
    const lines: string[] = [];

    const to = transition.kind === 'move' ? transition.to : undefined;
    if (to) {
      const outcome = await members.move(bot, member.id, to, {
        action: MOVE_ACTION[to.kind],
        preview: (name, was) => `${was} → ${members.standingName(to)}: ${name}`,
        done: (name) => name,
        restriction: { origin: 'check', reason: t.restrictReason },
      });
      if (outcome.status !== 'ok') {
        this.deps.logger.warn({ user: member.id, outcome }, 'legion check could not move member');
        lines.push(t.moveFailed(member.id, character.name, members.standingName(to)));
        return lines;
      }
      lines.push(
        transition.why === 'returned'
          ? t.returned(member.id, character.name, members.standingName(to))
          : t.moved(
              member.id,
              character.name,
              character.legion,
              fromName,
              members.standingName(to),
            ),
      );
    } else {
      lines.push(t.leaderLeft(member.id, character.name, legion, character.legion, fromName));
    }

    if (transition.review) {
      await this.deps
        .review({
          userId: member.id,
          kind: to?.kind === 'ally' ? 'ally' : 'restricted',
          character,
          allianceLegion: to?.kind === 'ally' ? (members.legionOf(to) ?? character.legion) : null,
          previousStanding: encodeStanding(from),
        })
        .catch((error: unknown) =>
          this.deps.logger.warn({ err: error, user: member.id }, 'could not open the review'),
        );
    }
    return lines;
  }

  private async syncMember(member: GuildMember, name: string, classKey: string): Promise<void> {
    const classRole = this.classRole(classKey);
    if (!classRole) return;
    const nickname = registrationNickname(classRole.emoji ?? '', name);
    await this.deps.runAction({
      actor: systemActor(this.deps.guild.client.user.id),
      action: 'member.sync',
      target: nickname,
      params: { userId: member.id, class: classKey, gameName: name },
      preview: nickname,
      execute: () => applyCharacter(member, this.deps.directory, { name, classRole }, t.syncReason),
    });
  }

  private async postReport(lines: string[]): Promise<void> {
    if (lines.length === 0) return;
    const key = this.deps.config.get().settings.characters.reportChannel;
    const channel = key ? this.deps.directory.channelByKey(key) : undefined;
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setColor(COLORS.gold)
      .setTitle(t.reportTitle)
      .setDescription(lines.join('\n').slice(0, 4096))
      .setTimestamp(new Date());
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  start(): () => void {
    this.deps.ranking
      .refresh()
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, 'ranking refresh failed'));
    return repeat(
      TICK_MS,
      () => this.runIfDue(),
      (error) => this.deps.logger.warn({ err: error }, 'legion check crashed'),
    );
  }
}
