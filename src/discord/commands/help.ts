import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { tierAtLeast, type Tier } from '../../core/tiers.js';
import { ptBR } from '../../i18n/pt-BR.js';
import type { SlashCommand } from './types.js';

const t = ptBR.help;
const HELP_COLOR = 0xa855f7;

export interface HelpEntry {
  /** How to call it, e.g. "/voice rename". */
  readonly usage: string;
  readonly text: string;
  /** Lowest tier that can use it (from the action policies). */
  readonly tier: Tier;
}

export interface HelpSection {
  readonly title: string;
  readonly entries: readonly HelpEntry[];
}

/** The sections and commands a member of this tier can use; empty sections are left out. */
export function helpFor(tier: Tier, sections: readonly HelpSection[] = t.sections): HelpSection[] {
  return sections
    .map((section) => ({
      title: section.title,
      entries: section.entries.filter((entry) => tierAtLeast(tier, entry.tier)),
    }))
    .filter((section) => section.entries.length > 0);
}

export function helpEmbed(tier: Tier): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(HELP_COLOR)
    .setTitle(t.title)
    .setDescription(t.intro)
    .setFooter({ text: t.footer(ptBR.tier(tier)) });
  for (const section of helpFor(tier)) {
    embed.addFields({
      name: section.title,
      value: section.entries.map((e) => `\`${e.usage}\` · ${e.text}`).join('\n'),
    });
  }
  return embed;
}

export const helpCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('What Padrinho can do for you')
    .setDescriptionLocalizations({ 'pt-BR': 'O que o Padrinho pode fazer por você' })
    .toJSON(),

  async execute(interaction, ctx) {
    const actor = await ctx.resolveActor(interaction.user.id);
    await interaction.reply({ embeds: [helpEmbed(actor.tier)], flags: MessageFlags.Ephemeral });
  },
};
