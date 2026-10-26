import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { summarizePatchNote, type PatchNote } from '../core/patch-notes.js';
import { ptBR } from '../i18n/pt-BR.js';
import { COLORS } from './colors.js';

const t = ptBR.patchNotes;

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
 * One card per patch notes: name, banner, the opening line, the highlighted topics of each section
 * and a button to the full notes on Steam.
 */
export function patchNoteMessage(note: PatchNote): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const summary = summarizePatchNote(note);
  const embed = new EmbedBuilder()
    .setColor(COLORS.blue)
    .setAuthor({ name: t.author })
    .setTitle(`📜 ${summary.name}`.slice(0, 256))
    .setURL(note.url)
    .setDescription(
      [
        ...(summary.when ? [`🗓️ ${summary.when}`] : []),
        ...(summary.intro ? [summary.intro] : []),
      ].join('\n\n') || t.intro,
    )
    .setFooter({ text: t.footer })
    .setTimestamp(note.postedAt);
  if (note.imageUrl) embed.setImage(note.imageUrl);

  for (const section of summary.sections.slice(0, 6)) {
    embed.addFields({
      name: `${sectionEmoji(section.title)} ${section.title}`.slice(0, 256),
      value:
        section.highlights.length > 0
          ? section.highlights.map((h) => `• ${h}`).join('\n')
          : t.seeDetails,
    });
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
