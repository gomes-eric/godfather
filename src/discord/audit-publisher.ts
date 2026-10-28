import { EmbedBuilder } from 'discord.js';
import type { AuditPublisher, AuditResult, RecordedAuditEntry } from '../core/audit.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import type { GuildDirectory } from './directory.js';

const t = ptBR.audit;

const RESULT_COLORS: Record<AuditResult, number> = {
  ok: 0x4fb286,
  denied: 0xe0303a,
  error: 0xe0303a,
  confirmation_required: 0xe6c46a,
};

const MAX_DETAIL_LINES = 10;
const MAX_VALUE_LENGTH = 120;
const SNOWFLAKE = /^\d{17,20}$/;

/** One readable value: ids become mentions, dates become Discord timestamps. */
function formatValue(key: string, value: unknown): string {
  if (typeof value === 'boolean') return value ? t.yes : t.no;
  if (Array.isArray(value)) return value.map((v) => formatValue(key, v)).join(', ');
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  if (SNOWFLAKE.test(text)) {
    if (key === 'channelId') return `<#${text}>`;
    if (key === 'roleId') return `<@&${text}>`;
    if (key === 'userId' || key === 'authorId' || key === 'owner') return `<@${text}>`;
  }
  if (key === 'startsAt' && !Number.isNaN(Date.parse(text))) {
    return `<t:${Math.floor(Date.parse(text) / 1000)}:f>`;
  }
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

/** "• **Motivo:** flood" lines for the parameters, most useful first. */
export function formatDetails(params: Record<string, unknown>): string {
  const lines = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `• **${t.params[key] ?? key}:** ${formatValue(key, value)}`);
  const extra = lines.length - MAX_DETAIL_LINES;
  return [...lines.slice(0, MAX_DETAIL_LINES), ...(extra > 0 ? [`• … +${extra}`] : [])].join('\n');
}

export interface AuditCard {
  title: string;
  color: number;
  fields: { name: string; value: string; inline: boolean }[];
  footer: string;
}

/** The #audit-log entry: what happened, who did it, how, to what, and the details. */
export function auditCard(entry: RecordedAuditEntry): AuditCard {
  const f = t.fields;
  const fields: AuditCard['fields'] = [
    { name: f.actor, value: `<@${entry.actor.userId}>`, inline: true },
    { name: f.source, value: t.source(entry.actor.source, entry.actor.harness), inline: true },
    { name: f.result, value: t.result(entry.result), inline: true },
  ];
  if (entry.target) fields.push({ name: f.target, value: entry.target, inline: false });
  if (entry.params && Object.keys(entry.params).length > 0) {
    const details = formatDetails(entry.params);
    if (details) fields.push({ name: f.params, value: details.slice(0, 1024), inline: false });
  }
  return {
    title: t.actions[entry.action] ?? entry.action,
    color: RESULT_COLORS[entry.result],
    fields,
    footer: `#${entry.id} · ${entry.action}`,
  };
}

function buildAuditEmbed(entry: RecordedAuditEntry): EmbedBuilder {
  const card = auditCard(entry);
  return new EmbedBuilder()
    .setTitle(card.title)
    .setColor(card.color)
    .addFields(card.fields)
    .setFooter({ text: card.footer })
    .setTimestamp(entry.at);
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
