import { EmbedBuilder, type Guild, type GuildMember } from 'discord.js';
import { classRoles, type RoleConfig } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import type { ActionRunner } from '../core/action.js';
import { systemActor } from '../core/actor.js';
import { matchClass, sameLegion } from '../core/game-character.js';
import { characterChanges, checkDue, rankingLines } from '../core/legion-check.js';
import { registrationNickname } from '../core/registration.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import type { CharacterStore, RegisteredCharacter } from '../db/characters.js';
import type { ManagedObjectStore } from '../db/managed-objects.js';
import { applyCharacter } from '../discord/character-registration.js';
import { COLORS } from '../discord/colors.js';
import type { GuildDirectory } from '../discord/directory.js';
import { fetchMember } from '../discord/members.js';
import { rankingMenu } from '../discord/ranking-menu.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import type { GameCharacterService } from './game-character.service.js';

const t = ptBR.legionCheck;
const RANKING_MESSAGE_KEY = 'ranking-board';
/** How often to look whether a check is due. */
const TICK_MS = 60 * 60_000;
/** Pause between characters, to be gentle with the official site. */
const PAUSE_MS = 1_500;

interface Deps {
  guild: Guild;
  config: ConfigStore;
  directory: GuildDirectory;
  managed: ManagedObjectStore;
  registrations: CharacterStore;
  characters: GameCharacterService;
  runAction: ActionRunner;
  logger: Logger;
  pause?: (ms: number) => Promise<void>;
}

/**
 * Once a day, re-reads every registered character on the official site: a class or name change
 * updates the member's class role and nickname, a character that left (or joined) the legion is
 * reported to the officers, and the #ranking board is rebuilt from the fresh numbers.
 */
export class LegionCheckService implements BackgroundJob {
  private running = false;
  private readonly pause: (ms: number) => Promise<void>;

  constructor(private readonly deps: Deps) {
    this.pause = deps.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private classRole(key: string): RoleConfig | undefined {
    return classRoles(this.deps.config.get()).find((role) => role.key === key);
  }

  /** Checks everyone if a check is due; returns the report lines it posted. */
  async runIfDue(now = new Date()): Promise<string[]> {
    const checkedAt = this.deps.registrations.all().map((row) => row.checkedAt);
    return checkDue(checkedAt, now) ? this.check() : [];
  }

  async check(): Promise<string[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const report: string[] = [];
      for (const row of this.deps.registrations.all()) {
        const lines = await this.checkOne(row).catch((error: unknown) => {
          this.deps.logger.warn({ err: error, user: row.userId }, 'legion check failed for member');
          return [];
        });
        report.push(...lines);
        await this.pause(PAUSE_MS);
      }
      await this.postReport(report);
      await this.refreshRanking();
      this.deps.logger.info({ changes: report.length }, 'legion check done');
      return report;
    } finally {
      this.running = false;
    }
  }

  private async checkOne(row: RegisteredCharacter): Promise<string[]> {
    const { guild, registrations, characters, config } = this.deps;
    const member = await fetchMember(guild, row.userId);
    if (!member) return []; // Left the Discord; nothing to update.

    const profile = await characters.profile({ id: row.characterId, serverId: row.serverId }, true);
    const classRole = matchClass(profile.className, classRoles(config.get()));
    const legion = config.get().settings.characters.legion;
    const now = {
      name: profile.name,
      classKey: classRole?.key ?? row.classKey,
      legion: profile.legion,
    };
    const changes = characterChanges(row, now, legion);
    // Registered before the legion was stored: this first check only sets the baseline.
    if (!row.checkedAt) {
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
    if (changes.leftLegion) lines.push(t.left(member.id, now.name, legion, now.legion));
    if (changes.joinedLegion) lines.push(t.joined(member.id, now.name, legion));

    registrations.updateSnapshot(row.userId, {
      ...now,
      combatPower: profile.combatPower,
      itemLevel: profile.itemLevel,
    });
    return lines;
  }

  /** New class role and "⚔️ Nome" nickname, done by the bot and audited as Padrinho. */
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

  /** Rebuilds the #ranking board from what is stored (no requests to the site). */
  async refreshRanking(): Promise<void> {
    const { config, directory, managed, registrations, guild } = this.deps;
    const settings = config.get().settings.characters;
    const channel = settings.rankingChannel
      ? directory.channelByKey(settings.rankingChannel)
      : undefined;
    if (!channel) return;

    // Ask Discord who is still in the server: the member cache only holds those seen since startup.
    const inLegion = registrations.all().filter((row) => sameLegion(row.legion, settings.legion));
    const present =
      inLegion.length > 0
        ? await guild.members.fetch({ user: inLegion.map((row) => row.userId) })
        : new Map<string, unknown>();
    const rows = inLegion
      .filter((row) => present.has(row.userId))
      .map((row) => ({
        userId: row.userId,
        name: row.name,
        classEmoji: this.classRole(row.classKey)?.emoji ?? '🎮',
        combatPower: row.combatPower,
        itemLevel: row.itemLevel,
      }));
    const lines = rankingLines(rows);
    const embed = new EmbedBuilder()
      .setColor(COLORS.gold)
      .setTitle(t.rankingTitle(settings.legion))
      .setDescription(
        [
          t.rankingIntro,
          '',
          ...(lines.length > 0 ? [...lines, '', t.menuHint] : [t.rankingEmpty]),
        ].join('\n'),
      )
      .setFooter({ text: t.rankingFooter })
      .setTimestamp(new Date());

    const stored = managed.get('message', RANKING_MESSAGE_KEY);
    const existing = stored
      ? await channel.messages.fetch(stored.discordId).catch(() => null)
      : null;
    const payload = { embeds: [embed], components: rankingMenu(rows) };
    if (existing) {
      await existing.edit(payload);
    } else {
      const sent = await channel.send({ ...payload, allowedMentions: { parse: [] } });
      managed.set('message', RANKING_MESSAGE_KEY, sent.id, null);
    }
  }

  start(): () => void {
    this.refreshRanking().catch((error: unknown) =>
      this.deps.logger.warn({ err: error }, 'ranking refresh failed'),
    );
    return repeat(
      TICK_MS,
      () => this.runIfDue(),
      (error) => this.deps.logger.warn({ err: error }, 'legion check crashed'),
    );
  }
}
