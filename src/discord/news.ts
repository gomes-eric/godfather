import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
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

  const link = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setURL(note.url)
    .setLabel(t.button)
    .setEmoji('📖');
  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(link)],
  };
}
