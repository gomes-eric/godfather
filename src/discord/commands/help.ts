import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { tierAtLeast, type Tier } from '../../core/tiers.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { COLORS } from '../colors.js';
import { replyPrivately } from '../replies.js';
import type { SlashCommand } from './types.js';

const t = ptBR.help;

export interface HelpEntry {
  readonly usage: string;
  readonly text: string;
  readonly tier: Tier;
}

export interface HelpSection {
  readonly title: string;
  readonly entries: readonly HelpEntry[];
}

export function helpFor(tier: Tier): HelpSection[] {
  return t.sections
    .map((section) => ({
      title: section.title,
      entries: section.entries.filter((entry) => tierAtLeast(tier, entry.tier)),
    }))
    .filter((section) => section.entries.length > 0);
}

export function helpEmbed(tier: Tier): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
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
    await replyPrivately(interaction, { embeds: [helpEmbed(actor.tier)] });
  },
};
