import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageMentionOptions,
} from 'discord.js';
import type { NewsDigest } from '../core/news-digest.js';
import {
  newsExcerpt,
  newsKind,
  summarizeNews,
  type NewsKind,
  type NewsPost,
} from '../core/news.js';
import { ptBR } from '../i18n/pt-BR.js';
import { COLORS } from './colors.js';

const t = ptBR.news;

const KIND_STYLE: Record<NewsKind, { emoji: string; color: number }> = {
  patch: { emoji: '📜', color: COLORS.blue },
  maintenance: { emoji: '🛠️', color: COLORS.amber },
  event: { emoji: '🎉', color: COLORS.violet },
  restriction: { emoji: '🚫', color: COLORS.crimson },
  notice: { emoji: '📰', color: COLORS.slate },
};

/** Room for the start of a post that has no sections to list. */
const EXCERPT_LENGTH = 700;

/** An emoji for a section, from words in its title. */
function sectionEmoji(title: string): string {
  const lower = title.toLowerCase();
  if (/evento/.test(lower)) return '🎉';
  if (/loja|ba[úu]|pacote/.test(lower)) return '🛍️';
  if (/classe|habilidade/.test(lower)) return '⚔️';
  if (/corre[çc]|melhoria|bug/.test(lower)) return '🔧';
  if (/conte[úu]do|sistema/.test(lower)) return '🧭';
  return '📌';
}

/**
 * One card per Steam post: name, banner and a button to the full post. Posts split into
 * "[Section]" headings (the patch notes) list each section's highlighted topics; the others show
 * their opening paragraphs.
 */
export function newsMessage(note: NewsPost): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
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

  return { embeds: [embed], components: [linkRow(note.url)] };
}

function linkRow(url: string) {
  const link = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setURL(url)
    .setLabel(t.button)
    .setEmoji('📖');
  return new ActionRowBuilder<ButtonBuilder>().addComponents(link);
}

/** Who a summary pings: everyone when it concerns Triniel, and the roles of changed classes. */
export interface DigestPing {
  everyone: boolean;
  roleIds: string[];
}

const MAX_SECTIONS = 6;
const MAX_POINTS = 6;
const FIELD_MAX = 1024;

/** The card for a Claude summary: same look as the plain card, with only what matters. */
export function digestMessage(
  note: Pick<NewsPost, 'url' | 'imageUrl' | 'postedAt'>,
  digest: NewsDigest,
  ping: DigestPing,
): {
  content: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
  allowedMentions: MessageMentionOptions;
} {
  const style = KIND_STYLE[digest.kind];
  const when = digest.when ? [`🗓️ ${digest.when}`] : [];
  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setAuthor({ name: t.author[digest.kind] })
    .setTitle(`${style.emoji} ${digest.title}`.slice(0, 256))
    .setURL(note.url)
    .setDescription(
      [...when, digest.summary].filter(Boolean).join('\n\n').slice(0, 4096) || t.intro,
    )
    .setFooter({ text: t.digestFooter })
    .setTimestamp(note.postedAt);
  if (note.imageUrl) embed.setImage(note.imageUrl);
  for (const section of digest.sections.slice(0, MAX_SECTIONS)) {
    const points = section.points.slice(0, MAX_POINTS).map((p) => `• ${p}`);
    if (points.length === 0) continue;
    embed.addFields({
      name: `${section.emoji} ${section.title}`.slice(0, 256),
      value: points.join('\n').slice(0, FIELD_MAX),
    });
  }

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
