import { EmbedBuilder, type Guild } from 'discord.js';
import { classRoles } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import { sameLegion } from '../core/game-character.js';
import { rankingLines } from '../core/legion-check.js';
import type { CharacterStore } from '../db/characters.js';
import type { ManagedObjectStore } from '../db/managed-objects.js';
import { COLORS } from '../discord/colors.js';
import type { GuildDirectory } from '../discord/directory.js';
import { rankingMenu } from '../discord/ranking-menu.js';
import { ptBR } from '../i18n/pt-BR.js';

const t = ptBR.legionCheck;
const RANKING_MESSAGE_KEY = 'ranking-board';

interface Deps {
  guild: Guild;
  config: ConfigStore;
  directory: GuildDirectory;
  managed: ManagedObjectStore;
  registrations: CharacterStore;
}

/** The #ranking board: registered legion members by combat power, from what is stored. */
export class RankingBoard {
  constructor(private readonly deps: Deps) {}

  async refresh(): Promise<void> {
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
    const classes = classRoles(config.get());
    const rows = inLegion
      .filter((row) => present.has(row.userId))
      .map((row) => ({
        userId: row.userId,
        name: row.name,
        classEmoji: classes.find((role) => role.key === row.classKey)?.emoji ?? '🎮',
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
}
