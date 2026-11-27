import { EmbedBuilder } from 'discord.js';
import { classRoles } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import { systemActor, type Actor } from '../core/actor.js';
import { matchClass, type CharacterProfile } from '../core/game-character.js';
import {
  batchVerdict,
  checkDue,
  legionToSave,
  MAX_DEPARTURES,
  memberVerdict,
  reviewFor,
  type CheckEvent,
  type MemberVerdict,
} from '../core/legion-check.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import { allyOf, type Standing } from '../core/standing.js';
import type { CharacterStore, RegisteredCharacter } from '../db/characters.js';
import type { RestrictionStore } from '../db/restrictions.js';
import { COLORS } from '../discord/colors.js';
import { officerChannel } from '../discord/officer-notices.js';
import type { GuildDirectory } from '../discord/directory.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import type { GameCharacterService } from './game-character.service.js';
import type { RankingBoard } from './ranking-board.service.js';
import type { ReviewRequest } from './recruitment.service.js';
import type { Roster } from './roster.service.js';
import { ownLegion } from '../config/views.js';

const t = ptBR.legionCheck;
const TICK_MS = 60 * 60_000;
const PAUSE_MS = 1_500;

interface Deps {
  config: ConfigStore;
  directory: GuildDirectory;
  ranking: RankingBoard;
  registrations: CharacterStore;
  characters: GameCharacterService;
  roster: Roster;
  restrictions: RestrictionStore;
  review: (request: ReviewRequest) => Promise<void>;
  botUserId: string;
  runAction: ActionRunner;
  logger: Logger;
  pause?: (ms: number) => Promise<void>;
}

interface Checked {
  userId: string;
  from: Standing;
  character: CharacterProfile;
  verdict: MemberVerdict;
  lines: string[];
  combatPower: number | null;
  itemLevel: number | null;
}

export class LegionCheckService implements BackgroundJob {
  private running = false;
  private readonly pause: (ms: number) => Promise<void>;

  constructor(private readonly deps: Deps) {
    this.pause = deps.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private bot() {
    return systemActor(this.deps.botUserId);
  }

  private className(key: string): string {
    return classRoles(this.deps.config.get()).find((role) => role.key === key)?.name ?? key;
  }

  async runIfDue(now = new Date()): Promise<string[]> {
    const checkedAt = this.deps.registrations.all().map((row) => row.checkedAt);
    return checkDue(checkedAt, now) ? this.check() : [];
  }

  get isChecking(): boolean {
    return this.running;
  }

  async runNow(actor: Actor): Promise<ServiceOutcome<{ report: string[]; members: number }>> {
    if (this.running) return rejected(t.commandBusy);
    return this.deps.runAction({
      actor,
      action: 'legion.check',
      preview: 'legion.check',
      execute: async () => ({
        report: await this.check(),
        members: this.deps.registrations.all().length,
      }),
    });
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
      const report = await this.carryOutAll(checked);
      await this.postReport(report);
      await this.deps.ranking.refresh();
      this.deps.logger.info({ changes: report.length }, 'legion check done');
      return report;
    } finally {
      this.running = false;
    }
  }

  private async checkOne(row: RegisteredCharacter): Promise<Checked | undefined> {
    const { characters, config, roster } = this.deps;
    const from = await roster.standingOf(row.userId);
    if (!from) return undefined;

    const character = await characters.profile(
      { id: row.characterId, serverId: row.serverId },
      true,
    );
    const classKey = matchClass(character.className, classRoles(config.get()))?.key ?? row.classKey;
    const verdict = memberVerdict({
      before: row,
      now: { name: character.name, classKey, legion: character.legion },
      legion: ownLegion(config.get()),
      alliances: config.get().alliances,
      standing: from,
      restrictedBy: this.deps.restrictions.get(row.userId)?.origin,
    });
    if (verdict.sync) {
      const synced = await roster.change(this.bot(), row.userId, {
        character: { classKey: verdict.sync.classKey, gameName: verdict.sync.name },
        cause: { kind: 'legionCheck' },
      });
      if (synced.status !== 'ok') {
        this.deps.logger.warn({ user: row.userId, synced }, 'class or nickname not updated');
      }
    }
    return {
      userId: row.userId,
      from,
      character,
      verdict,
      lines: verdict.events.map((event) => this.eventLine(row.userId, character.name, event)),
      combatPower: character.combatPower,
      itemLevel: character.itemLevel,
    };
  }

  private eventLine(userId: string, name: string, event: CheckEvent): string {
    const legion = ownLegion(this.deps.config.get());
    switch (event.kind) {
      case 'renamed':
        return t.renamed(userId, event.from, event.to);
      case 'classChanged':
        return t.classChanged(userId, this.className(event.from), this.className(event.to));
      case 'left':
        return t.left(userId, name, legion, event.now);
      case 'joined':
        return t.joined(userId, name, legion);
    }
  }

  private async carryOutAll(checked: Checked[]): Promise<string[]> {
    const report = checked.flatMap((c) => c.lines);
    const { departures, holdBack } = batchVerdict(checked.map((c) => c.verdict));
    if (holdBack) report.push(t.tooManyDepartures(departures, MAX_DEPARTURES));

    for (const c of checked) {
      if (c.verdict.transition && holdBack) {
        report.push(t.heldBack(c.userId, c.character.name, c.character.legion));
      } else if (c.verdict.transition) {
        report.push(...(await this.carryOut(c)));
      }
      this.deps.registrations.updateSnapshot(c.userId, {
        ...c.verdict.now,
        legion: legionToSave(c.verdict, holdBack),
        combatPower: c.combatPower,
        itemLevel: c.itemLevel,
      });
    }
    return report;
  }

  private async carryOut(c: Checked): Promise<string[]> {
    const transition = c.verdict.transition!;
    const { roster } = this.deps;
    const { character, userId, from } = c;
    const fromName = roster.standingName(from);
    const lines: string[] = [];

    if (transition.kind === 'move') {
      const to = transition.to;
      const outcome = await roster.change(this.bot(), userId, {
        to,
        cause: { kind: 'legionCheck' },
      });
      if (outcome.status !== 'ok') {
        this.deps.logger.warn({ user: userId, outcome }, 'legion check could not move member');
        return [t.moveFailed(userId, character.name, roster.standingName(to))];
      }
      lines.push(
        transition.why === 'returned'
          ? t.returned(userId, character.name, roster.standingName(to))
          : t.moved(userId, character.name, character.legion, fromName, roster.standingName(to)),
      );
    } else {
      const legion = ownLegion(this.deps.config.get());
      lines.push(t.leaderLeft(userId, character.name, legion, character.legion, fromName));
    }

    const review = reviewFor(transition, from);
    if (review) {
      await this.deps
        .review({
          userId,
          kind: review.kind,
          character,
          allianceLegion: review.allianceKey
            ? (roster.legionOf(allyOf(review.allianceKey)) ?? character.legion)
            : null,
          previous: review.previous,
        })
        .catch((error: unknown) =>
          this.deps.logger.warn({ err: error, user: userId }, 'could not open the review'),
        );
    }
    return lines;
  }

  private async postReport(lines: string[]): Promise<void> {
    if (lines.length === 0) return;
    const channel = officerChannel(this.deps.directory, this.deps.config);
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
