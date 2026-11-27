import { EmbedBuilder, type MessageCreateOptions } from 'discord.js';
import type { ServerConfig } from '../config/schema.js';
import { ptBR } from '../i18n/pt-BR.js';
import { COLORS } from './colors.js';

export function renderWelcome(
  template: string,
  memberId: string,
  channelId: (key: string) => string | undefined,
): string {
  return template
    .replaceAll('{member}', `<@${memberId}>`)
    .replace(/\{channel:([a-z0-9-]+)\}/g, (_, key: string) => {
      const id = channelId(key);
      return id ? `<#${id}>` : `#${key}`;
    })
    .trim();
}

export interface Newcomer {
  id: string;
  displayName: string;
  avatarUrl: string;
  memberCount: number;
}

/**
 * The welcome card: the title and message from server.yaml, one field per first step, the
 * newcomer's avatar and their member number. The mention also goes in `content`, because a
 * mention inside an embed does not notify anyone.
 */
export function welcomeCard(
  welcome: ServerConfig['settings']['welcome'],
  newcomer: Newcomer,
  channelId: (key: string) => string | undefined,
): Pick<MessageCreateOptions, 'content' | 'embeds' | 'allowedMentions'> {
  const render = (text: string) => renderWelcome(text, newcomer.id, channelId);
  const embed = new EmbedBuilder()
    .setColor(COLORS.crimson)
    .setAuthor({ name: newcomer.displayName, iconURL: newcomer.avatarUrl })
    .setThumbnail(newcomer.avatarUrl)
    .setDescription(render(welcome.message))
    .setFooter({ text: ptBR.welcome.footer(newcomer.memberCount) })
    .setTimestamp(new Date());
  if (welcome.title) embed.setTitle(render(welcome.title));
  if (welcome.steps.length > 0) {
    embed.addFields(
      welcome.steps.map((step) => ({ name: render(step.name), value: render(step.value) })),
    );
  }
  return {
    content: ptBR.welcome.ping(newcomer.id),
    embeds: [embed],
    allowedMentions: { users: [newcomer.id] },
  };
}
