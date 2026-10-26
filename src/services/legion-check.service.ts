import { EmbedBuilder, type Guild, type GuildMember } from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import type { ActionRunner } from '../core/action.js';
import { systemActor } from '../core/actor.js';
import { matchClass, sameLegion } from '../core/game-character.js';
import { characterChanges, checkDue, rankingLines } from '../core/legion-check.js';
import { registrationNickname, rolesWithClass } from '../core/registration.js';
import type { CharacterStore, RegisteredCharacter } from '../db/characters.js';
import type { ManagedObjectStore } from '../db/managed-objects.js';
import type { GuildDirectory } from '../discord/directory.js';
import { rankingMenu } from '../discord/ranking-menu.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import type { GameCharacterService } from './game-character.service.js';
import type { MemberService } from './member.service.js';

const t = ptBR.legionCheck;
const RANKING_MESSAGE_KEY = 'ranking-board';
const RANKING_COLOR = 0xd9b45a;
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
  members: MemberService;
  runAction: ActionRunner;
  logger: Logger;
  pause?: (ms: number) => Promise<void>;
}

/**
 * Once a day, re-reads every registered character on the official site: a class or name change
 * updates the member's class role and nickname, a character that left (or joined) the legion is
 * reported to the officers, and the #ranking board is rebuilt from the fresh numbers.
 */
export class LegionCheckService {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly pause: (ms: number) => Promise<void>;

  constructor(private readonly deps: Deps) {
    this.pause = deps.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private classRoles() {
    return this.deps.config.get().roles.filter((role) => role.class && role.emoji);
  }

  private classEmoji(classKey: string): string {
    return this.classRoles().find((role) => role.key === classKey)?.emoji ?? '🎮';
  }

  /** Checks everyone if a check is due; returns the report lines it posted. */
  async runIfDue(now = new Date()): Promise<string[]> {
    const rows = this.deps.registrations.all();
    if (
      !checkDue(
        rows.map((row) => row.checkedAt),
        now,
      )
    )
      return [];
    return this.check();
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
    const member = await guild.members.fetch(row.userId).catch(() => null);
    if (!member) return []; // Left the Discord; nothing to update.

    const profile = await characters.profile({ id: row.characterId, serverId: row.serverId }, true);
    const classRole = matchClass(profile.className, this.classRoles());
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
      if (changes.renamed)
        lines.push(t.renamed(member.id, changes.renamed.from, changes.renamed.to));
      if (changes.classChanged) {
        const name = (key: string) => this.classRoles().find((r) => r.key === key)?.name ?? key;
        lines.push(
          t.classChanged(member.id, name(changes.classChanged.from), name(changes.classChanged.to)),
        );
      }
    }
    if (changes.leftLegion) lines.push(t.left(member.id, now.name, legion, now.legion));
    if (changes.joinedLegion) {
      const promoted = await this.deps.members.admitFromGame(member.id, now.name);
      lines.push(t.joined(member.id, now.name, legion, promoted));
    }

    registrations.updateSnapshot(row.userId, {
      ...now,
      combatPower: profile.combatPower,
      itemLevel: profile.itemLevel,
    });
    return lines;
  }

  /** New class role and "⚔️ Nome" nickname, done by the bot and audited as Padrinho. */
  private async syncMember(member: GuildMember, name: string, classKey: string): Promise<void> {
    const { guild, directory, runAction } = this.deps;
    const roles = this.classRoles();
    const classId = directory.roleId(classKey);
    const emoji = roles.find((r) => r.key === classKey)?.emoji ?? '';
    const nickname = registrationNickname(emoji, name);
    await runAction({
      actor: systemActor(guild.client.user.id),
      action: 'member.sync',
      target: nickname,
      params: { userId: member.id, class: classKey, gameName: name },
      preview: nickname,
      execute: async () => {
        if (classId) {
          const classIds = roles
            .map((r) => directory.roleId(r.key))
            .filter((id): id is string => id !== undefined);
          const current = [...member.roles.cache.keys()].filter((id) => id !== guild.id);
          await member.roles.set(rolesWithClass(current, classId, classIds));
        }
        if (member.id !== guild.ownerId && member.manageable && nickname.length <= 32) {
          await member.setNickname(nickname, 'Conferência diária da legião');
        }
        return nickname;
      },
    });
  }

  private async postReport(lines: string[]): Promise<void> {
    if (lines.length === 0) return;
    const key = this.deps.config.get().settings.characters.reportChannel;
    const channel = key ? this.deps.directory.channelByKey(key) : undefined;
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setColor(RANKING_COLOR)
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
        classEmoji: this.classEmoji(row.classKey),
        combatPower: row.combatPower,
        itemLevel: row.itemLevel,
      }));
    const lines = rankingLines(rows);
    const embed = new EmbedBuilder()
      .setColor(RANKING_COLOR)
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
    const components = rankingMenu(rows);
    if (existing) {
      await existing.edit({ embeds: [embed], components });
    } else {
      const sent = await channel.send({
        embeds: [embed],
        components,
        allowedMentions: { parse: [] },
      });
      managed.set('message', RANKING_MESSAGE_KEY, sent.id, null);
    }
  }

  start(): void {
    const run = () => {
      this.runIfDue().catch((error: unknown) =>
        this.deps.logger.warn({ err: error }, 'legion check crashed'),
      );
    };
    this.refreshRanking().catch((error: unknown) =>
      this.deps.logger.warn({ err: error }, 'ranking refresh failed'),
    );
    run();
    this.timer = setInterval(run, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
