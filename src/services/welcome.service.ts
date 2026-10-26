import { EmbedBuilder, type Guild, type GuildMember, type MessageCreateOptions } from 'discord.js';
import { soldierLikeRoleKeys, type ServerConfig } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import { COLORS } from '../discord/colors.js';
import type { GuildDirectory } from '../discord/directory.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';

/**
 * Fills the welcome template: `{member}` → mention, `{channel:<key>}` → channel link.
 * Unknown channel keys are left as `#key` so a typo is visible instead of silent.
 */
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
  /** Members in the server, the newcomer included. */
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

interface Deps {
  guild: Guild;
  directory: GuildDirectory;
  config: ConfigStore;
  logger: Logger;
}

/** New members get Visitante and a welcome; bots get the Bot role (PLAN.md §6.8). */
export class WelcomeService {
  constructor(private readonly deps: Deps) {}

  private autoRoleIds() {
    const { welcome } = this.deps.config.get().settings;
    return {
      visitor: this.deps.directory.roleId(welcome.autoRole),
      bot: welcome.botRole ? this.deps.directory.roleId(welcome.botRole) : undefined,
    };
  }

  async onMemberJoin(member: GuildMember): Promise<void> {
    const { visitor, bot } = this.autoRoleIds();
    const { logger, directory, config } = this.deps;

    if (member.user.bot) {
      if (bot) await member.roles.add(bot, 'Bot joined');
      logger.info({ bot: member.user.tag }, 'bot joined');
      return;
    }

    if (visitor) await member.roles.add(visitor, 'New member');
    const { welcome } = config.get().settings;
    const channel = directory.channelByKey(welcome.channel);
    if (channel) {
      await channel.send(
        welcomeCard(
          welcome,
          {
            id: member.id,
            displayName: member.displayName,
            avatarUrl: member.displayAvatarURL({ size: 256 }),
            memberCount: member.guild.memberCount,
          },
          (key) => directory.channelByKey(key)?.id,
        ),
      );
    }
    logger.info({ member: member.user.tag }, 'member joined');
  }

  /**
   * Gives the automatic roles to members who joined before the bot (or before /setup):
   * bots without the Bot role, and humans without any legion role (Parceiro counts as one).
   */
  async syncAutoRoles(): Promise<{ bots: number; visitors: number }> {
    const { visitor, bot } = this.autoRoleIds();
    const legionRoles = new Set(Object.values(this.deps.directory.tierRoleIds()));
    if (visitor) legionRoles.add(visitor);
    for (const key of soldierLikeRoleKeys(this.deps.config.get())) {
      const id = this.deps.directory.roleId(key);
      if (id) legionRoles.add(id);
    }

    const members = await this.deps.guild.members.fetch();
    let bots = 0;
    let visitors = 0;
    for (const member of members.values()) {
      if (member.user.bot) {
        if (bot && !member.roles.cache.has(bot) && member.id !== this.deps.guild.client.user.id) {
          await member.roles.add(bot, 'Bot role sync');
          bots++;
        }
      } else if (visitor && ![...legionRoles].some((id) => member.roles.cache.has(id))) {
        await member.roles.add(visitor, 'Visitante sync');
        visitors++;
      }
    }
    return { bots, visitors };
  }
}
