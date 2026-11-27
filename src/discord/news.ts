import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageMentionOptions,
} from 'discord.js';
import { CARD_POINTS, CARD_SECTIONS, type NewsDigest } from '../core/news-digest.js';
import {
  newsExcerpt,
  newsKind,
  summarizeNews,
  type NewsKind,
  type NewsPost,
} from '../core/news.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { NewsPort } from '../services/news.service.js';
import { COLORS } from './colors.js';
import type { GuildDirectory } from './directory.js';

const t = ptBR.news;

const KIND_STYLE: Record<NewsKind, { emoji: string; color: number }> = {
  patch: { emoji: '📜', color: COLORS.blue },
  maintenance: { emoji: '🛠️', color: COLORS.amber },
  event: { emoji: '🎉', color: COLORS.violet },
  restriction: { emoji: '🚫', color: COLORS.crimson },
  notice: { emoji: '📰', color: COLORS.slate },
};

const EXCERPT_LENGTH = 700;

function sectionEmoji(title: string): string {
  const lower = title.toLowerCase();
  if (/evento/.test(lower)) return '🎉';
  if (/loja|ba[úu]|pacote/.test(lower)) return '🛍️';
  if (/classe|habilidade/.test(lower)) return '⚔️';
  if (/corre[çc]|melhoria|bug/.test(lower)) return '🔧';
  if (/conte[úu]do|sistema/.test(lower)) return '🧭';
  return '📌';
}

export interface NewsMessage {
  content?: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
  allowedMentions: MessageMentionOptions;
}

export function newsMessage(note: NewsPost): NewsMessage {
  const kind = newsKind(note.title);
  const style = KIND_STYLE[kind];
  const summary = summarizeNews(note);
  const sectioned = summary.sections.length >= 2;
  const when = summary.when ? [`🗓️ ${summary.when}`] : [];
  const text = sectioned ? summary.intro : newsExcerpt(note.body, EXCERPT_LENGTH);

  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setAuthor({ name: t.author[kind] })
    .setTitle(`${style.emoji} ${summary.name}`.slice(0, 256))
    .setURL(note.url)
    .setDescription([...when, ...(text ? [text] : [])].join('\n\n') || t.intro)
    .setFooter({ text: t.footer })
    .setTimestamp(note.postedAt);
  if (note.imageUrl) embed.setImage(note.imageUrl);

  if (sectioned) {
    for (const section of summary.sections.slice(0, 6)) {
      embed.addFields({
        name: `${sectionEmoji(section.title)} ${section.title}`.slice(0, 256),
        value:
          section.highlights.length > 0
            ? section.highlights.map((h) => `• ${h}`).join('\n')
            : t.seeDetails,
      });
    }
  }

  return { embeds: [embed], components: [linkRow(note.url)], allowedMentions: { parse: [] } };
}

function linkRow(url: string) {
  const link = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setURL(url)
    .setLabel(t.button)
    .setEmoji('📖');
  return new ActionRowBuilder<ButtonBuilder>().addComponents(link);
}

export interface DigestMentions {
  everyone: boolean;
  roleIds: string[];
}

const DESCRIPTION_MAX = 4096;

export function digestDescription(
  digest: Pick<NewsDigest, 'when' | 'summary' | 'sections'>,
): string {
  let text = [digest.when && `🗓️ ${digest.when}`, digest.summary].filter(Boolean).join('\n\n');
  for (const section of digest.sections.slice(0, CARD_SECTIONS)) {
    const points = section.points.slice(0, CARD_POINTS).map((point) => `- ${point}`);
    if (points.length === 0) continue;
    const block = [`### ${section.emoji} ${section.title}`, ...points].join('\n');
    const next = text ? `${text}\n\n${block}` : block;
    if (next.length > DESCRIPTION_MAX) break;
    text = next;
  }
  return text;
}

export function digestMessage(
  note: Pick<NewsPost, 'url' | 'imageUrl' | 'postedAt'>,
  digest: NewsDigest,
  ping: DigestMentions,
): NewsMessage {
  const style = KIND_STYLE[digest.kind];
  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setAuthor({ name: t.author[digest.kind] })
    .setTitle(`${style.emoji} ${digest.title}`.slice(0, 256))
    .setURL(note.url)
    .setDescription(digestDescription(digest) || t.intro)
    .setFooter({ text: t.digestFooter })
    .setTimestamp(note.postedAt);
  if (note.imageUrl) embed.setImage(note.imageUrl);

  const mentions = [
    ...(ping.everyone ? ['@everyone'] : []),
    ...ping.roleIds.map((id) => `<@&${id}>`),
  ];
  const reasons = [
    ...(ping.everyone ? [t.pingTriniel] : []),
    ...(ping.roleIds.length > 0 ? [t.pingClasses] : []),
  ];
  return {
    content: mentions.length > 0 ? `${mentions.join(' ')} · ${reasons.join(' · ')}` : '',
    embeds: [embed],
    components: [linkRow(note.url)],
    allowedMentions: { parse: ping.everyone ? ['everyone'] : [], roles: ping.roleIds },
  };
}

export function createDiscordNewsPort(directory: GuildDirectory): NewsPort {
  return {
    channel(key) {
      const channel = directory.channelByKey(key);
      return channel && { post: async (message) => (await channel.send(message)).id };
    },
    roleId: (key) => directory.roleId(key),
  };
}
