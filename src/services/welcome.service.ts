import type { Guild, GuildMember } from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import type { GuildDirectory } from '../discord/directory.js';
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
      await channel.send({
        content: renderWelcome(
          welcome.message,
          member.id,
          (key) => directory.channelByKey(key)?.id,
        ),
        allowedMentions: { users: [member.id] },
      });
    }
    logger.info({ member: member.user.tag }, 'member joined');
  }

  /**
   * Gives the automatic roles to members who joined before the bot (or before /setup):
   * bots without the Bot role, and humans without any legion role.
   */
  async syncAutoRoles(): Promise<{ bots: number; visitors: number }> {
    const { visitor, bot } = this.autoRoleIds();
    const legionRoles = new Set(Object.values(this.deps.directory.tierRoleIds()));
    if (visitor) legionRoles.add(visitor);

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
