import { ChannelType, ThreadAutoArchiveDuration, type Guild, type TextChannel } from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import type { Application } from '../db/applications.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import type { RecruitmentBoard } from '../services/recruitment-board.js';
import type { GuildDirectory } from './directory.js';
import { officerChannel } from './officer-notices.js';
import { applicationCard } from './recruitment.js';
import { recruitmentSettings } from '../config/views.js';

const t = ptBR.recruitment;

export function createDiscordRecruitmentBoard(deps: {
  guild: Guild;
  config: ConfigStore;
  directory: GuildDirectory;
  logger: Logger;
}): RecruitmentBoard {
  const { guild, config, directory, logger } = deps;
  const recruitment = () => recruitmentSettings(config.get());

  const staffIds = async (): Promise<string[]> => {
    const { officer, commander } = directory.tierRoleIds();
    const roles = [officer, commander].filter((id): id is string => id !== undefined);
    const members = await guild.members.fetch();
    return [...members.values()]
      .filter((member) => !member.user.bot && roles.some((id) => member.roles.cache.has(id)))
      .map((member) => member.id);
  };

  const cardChannel = async (application: Application) => {
    if (!application.threadId) {
      const settings = recruitment();
      return settings && directory.channelByKey(settings.reviewChannel);
    }
    const thread = await guild.channels.fetch(application.threadId).catch(() => null);
    if (!thread?.isThread()) return undefined;
    if (thread.archived) await thread.setArchived(false);
    return thread;
  };

  return {
    async post({ application, look }, { ping }) {
      const fromCheck = application.origin === 'check';
      const settings = recruitment();
      const parent: TextChannel | undefined = fromCheck
        ? officerChannel(directory, config)
        : settings && directory.channelByKey(settings.reviewChannel);
      if (!parent) return null;
      const name = application.character?.name ?? look.applicantName;
      const thread = await parent.threads.create({
        name: (fromCheck ? t.reviewThreadName(name) : t.threadName(name)).slice(0, 100),
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      });
      const people = fromCheck ? await staffIds() : [application.userId, ...(await staffIds())];
      for (const userId of people) {
        await thread.members
          .add(userId)
          .catch((error: unknown) =>
            logger.warn({ err: error, userId }, 'could not add to the application thread'),
          );
      }
      const pingId = ping && settings?.pingRole ? directory.roleId(settings.pingRole) : undefined;
      const intro = fromCheck ? t.newReview : t.newApplication;
      const sent = await thread.send({
        ...(pingId && { content: intro(pingId) }),
        ...applicationCard(application, look),
        allowedMentions: { roles: pingId ? [pingId] : [] },
      });
      return { threadId: thread.id, messageId: sent.id };
    },

    async refresh({ application, look }) {
      if (!application.messageId) return;
      const channel = await cardChannel(application);
      const message = await channel?.messages.fetch(application.messageId);
      await message?.edit({
        ...applicationCard(application, look),
        allowedMentions: { parse: [] },
      });
    },

    async say(application, content) {
      const settings = recruitment();
      if (!settings) return;
      const channel = settings.announceChannel
        ? directory.channelByKey(settings.announceChannel)
        : await cardChannel(application);
      await channel?.send({ content, allowedMentions: { users: [application.userId] } });
    },

    async deleteThread(threadId) {
      const thread = await guild.channels.fetch(threadId).catch(() => null);
      if (!thread?.isThread()) return false;
      await thread.delete(t.threadClosedReason);
      return true;
    },
  };
}
