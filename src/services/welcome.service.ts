import type { Guild, GuildMember } from 'discord.js';
import { soldierLikeRoleKeys } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import { planAutoRoles, type AutoRoleGrant, type AutoRoles } from '../core/auto-roles.js';
import { standingRoleIds } from '../core/standing.js';
import type { GuildDirectory } from '../discord/directory.js';
import { welcomeCard } from '../discord/welcome-card.js';
import type { Logger } from '../logger.js';

interface Deps {
  guild: Guild;
  directory: GuildDirectory;
  config: ConfigStore;
  logger: Logger;
}

export class WelcomeService {
  constructor(private readonly deps: Deps) {}

  private autoRoles(): AutoRoles {
    const { directory, config } = this.deps;
    const { welcome } = config.get().settings;
    const placed = standingRoleIds(directory.standingRoles());
    for (const key of soldierLikeRoleKeys(config.get())) {
      const id = directory.roleId(key);
      if (id) placed.add(id);
    }
    return {
      visitor: directory.roleId(welcome.autoRole),
      bot: welcome.botRole ? directory.roleId(welcome.botRole) : undefined,
      placed,
    };
  }

  private async grantAutoRoles(
    members: readonly GuildMember[],
    reason: Record<AutoRoleGrant['kind'], string>,
  ): Promise<AutoRoleGrant[]> {
    const byId = new Map(members.map((member) => [member.id, member]));
    const plan = planAutoRoles(
      members.map((member) => ({
        id: member.id,
        bot: member.user.bot,
        roleIds: [...member.roles.cache.keys()],
      })),
      this.autoRoles(),
      this.deps.guild.client.user.id,
    );
    for (const grant of plan) {
      await byId.get(grant.memberId)?.roles.add(grant.roleId, reason[grant.kind]);
    }
    return plan;
  }

  async onMemberJoin(member: GuildMember): Promise<void> {
    const { logger, directory, config } = this.deps;
    await this.grantAutoRoles([member], { bot: 'Bot joined', visitor: 'New member' });
    if (member.user.bot) {
      logger.info({ bot: member.user.tag }, 'bot joined');
      return;
    }

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

  async syncAutoRoles(): Promise<{ bots: number; visitors: number }> {
    const members = await this.deps.guild.members.fetch();
    const plan = await this.grantAutoRoles([...members.values()], {
      bot: 'Bot role sync',
      visitor: 'Visitante sync',
    });
    const count = (kind: AutoRoleGrant['kind']) => plan.filter((g) => g.kind === kind).length;
    return { bots: count('bot'), visitors: count('visitor') };
  }
}
