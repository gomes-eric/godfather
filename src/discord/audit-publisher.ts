import { EmbedBuilder } from 'discord.js';
import type { AuditPublisher, AuditResult, RecordedAuditEntry } from '../core/audit.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import type { GuildDirectory } from './directory.js';

const RESULT_COLORS: Record<AuditResult, number> = {
  ok: 0x4fb286,
  denied: 0xe0303a,
  error: 0xe0303a,
  confirmation_required: 0xe6c46a,
};

export function buildAuditEmbed(entry: RecordedAuditEntry): EmbedBuilder {
  const { fields } = ptBR.audit;
  const embed = new EmbedBuilder()
    .setTitle(entry.action)
    .setColor(RESULT_COLORS[entry.result])
    .setTimestamp(entry.at)
    .setFooter({ text: `#${entry.id}` })
    .addFields(
      {
        name: fields.actor,
        value: `<@${entry.actor.userId}> · ${ptBR.tier(entry.actor.tier)}`,
        inline: true,
      },
      {
        name: fields.source,
        value: ptBR.audit.source(entry.actor.source, entry.actor.harness),
        inline: true,
      },
      { name: fields.result, value: ptBR.audit.result(entry.result), inline: true },
    );

  if (entry.target) embed.addFields({ name: fields.target, value: entry.target });
  if (entry.params && Object.keys(entry.params).length > 0) {
    const json = JSON.stringify(entry.params, null, 2);
    embed.addFields({
      name: fields.params,
      value: `\`\`\`json\n${json.length > 1000 ? `${json.slice(0, 1000)}…` : json}\n\`\`\``,
    });
  }
  return embed;
}

/** Posts each audit entry to the configured audit channel, when it exists. */
export function createDiscordAuditPublisher(
  directory: GuildDirectory,
  auditChannelKey: () => string,
  logger: Logger,
): AuditPublisher {
  return {
    async publish(entry) {
      const channel = directory.channelByKey(auditChannelKey());
      if (!channel) {
        logger.debug({ auditId: entry.id }, 'audit channel not found; entry kept in the database');
        return;
      }
      await channel.send({ embeds: [buildAuditEmbed(entry)], allowedMentions: { parse: [] } });
    },
  };
}
