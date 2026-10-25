import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageType,
  type Guild,
  type MessageCreateOptions,
} from 'discord.js';
import type { ServerConfig } from '../config/schema.js';
import { localParts } from '../core/schedule.js';
import { ptBR } from '../i18n/pt-BR.js';
import type {
  AnnouncementPort,
  OccurrenceView,
  ReminderMessage,
  RsvpSummary,
} from '../services/reminder.scheduler.js';
import type { GuildDirectory } from './directory.js';

const t = ptBR.events;
export const RSVP_PREFIX = 'rsvp:';
const unix = (date: Date) => Math.floor(date.getTime() / 1000);

/** "2 Clérigo, 1 Templário" for the people who said yes. */
function classBreakdown(
  guild: Guild,
  directory: GuildDirectory,
  config: ServerConfig,
  userIds: string[],
): string {
  const counts = new Map<string, number>();
  for (const role of config.roles.filter((r) => r.class)) {
    const roleId = directory.roleId(role.key);
    if (!roleId) continue;
    const count = userIds.filter((id) =>
      guild.members.cache.get(id)?.roles.cache.has(roleId),
    ).length;
    if (count > 0) counts.set(role.name, count);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${count} ${name}`)
    .join(', ');
}

function rsvpButtons(occurrenceId: number) {
  const button = (status: 'yes' | 'maybe' | 'no', emoji: string, style: ButtonStyle) =>
    new ButtonBuilder()
      .setCustomId(`${RSVP_PREFIX}${occurrenceId}:${status}`)
      .setLabel(t.buttons[status])
      .setEmoji(emoji)
      .setStyle(style);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button('yes', '✅', ButtonStyle.Success),
    button('maybe', '❔', ButtonStyle.Secondary),
    button('no', '❌', ButtonStyle.Secondary),
  );
}

/** Builds the reminder text; the ping line only matters on the first post (edits never ping). */
export function reminderContent(message: ReminderMessage, rsvpClasses: string): string {
  const { occurrence: o, offsetMinutes, rsvp } = message;
  const lines = [
    ...(o.ping ? ['@everyone'] : []),
    offsetMinutes > 0
      ? t.reminderSoon(o.emoji, o.title, offsetMinutes, unix(o.startsAt))
      : t.reminderNow(o.emoji, o.title, unix(o.startsAt)),
    ...(o.voiceChannelId ? [t.room(o.voiceChannelId)] : []),
    ...(o.description ? [o.description] : []),
    ...(o.rsvp
      ? [t.rsvpLine(rsvp.yes.length, rsvp.maybe.length, rsvp.no.length, rsvpClasses)]
      : []),
  ];
  return lines.join('\n');
}

/** The #agenda embed: next 7 days grouped by day (in the server timezone). */
export function agendaDescription(items: OccurrenceView[], timeZone: string): string {
  if (items.length === 0) return t.agendaEmpty;
  const days = new Map<string, string[]>();
  for (const item of items) {
    const local = localParts(item.startsAt, timeZone);
    const header = `**${t.weekdays[local.weekday]}, ${String(local.day).padStart(2, '0')}/${String(local.month).padStart(2, '0')}**`;
    const line = `<t:${unix(item.startsAt)}:t> ${item.emoji} ${item.title}${
      item.voiceChannelId ? ` · <#${item.voiceChannelId}>` : ''
    } \`#${item.occurrenceId}\``;
    days.set(header, [...(days.get(header) ?? []), line]);
  }
  return [...days.entries()].map(([header, lines]) => [header, ...lines].join('\n')).join('\n\n');
}

/** AnnouncementPort for Discord: reminders in #avisos-eventos, the agenda in #agenda. */
export function createDiscordAnnouncements(
  guild: Guild,
  directory: GuildDirectory,
  config: () => ServerConfig,
): AnnouncementPort {
  const channel = (key: string) => {
    const found = directory.channelByKey(key);
    if (!found) throw new Error(`channel "${key}" not found; run /setup`);
    return found;
  };

  const payload = (message: ReminderMessage) => {
    const classes = classBreakdown(guild, directory, config(), message.rsvp.yes);
    return {
      content: reminderContent(message, classes),
      components: message.occurrence.rsvp ? [rsvpButtons(message.occurrence.occurrenceId)] : [],
    };
  };

  return {
    async postReminder(message) {
      const target = channel(config().settings.eventDefaults.announceChannel);
      const sent = await target.send({
        ...payload(message),
        allowedMentions: { parse: message.occurrence.ping ? ['everyone'] : [] },
      } satisfies MessageCreateOptions);
      return sent.id;
    },

    async refreshReminder(messageId, message) {
      const target = channel(config().settings.eventDefaults.announceChannel);
      const existing = await target.messages.fetch(messageId).catch(() => null);
      await existing?.edit({ ...payload(message), allowedMentions: { parse: [] } });
    },

    async upsertAgenda(messageId, items) {
      const target = channel(config().settings.eventDefaults.agendaChannel);
      const embed = new EmbedBuilder()
        .setTitle(t.agendaTitle)
        .setColor(0xa855f7)
        .setDescription(agendaDescription(items, config().settings.timezone))
        .setFooter({ text: t.agendaFooter })
        .setTimestamp(new Date());
      const body = { embeds: [embed], allowedMentions: { parse: [] } };

      const existing = messageId ? await target.messages.fetch(messageId).catch(() => null) : null;
      if (existing) {
        await existing.edit(body);
        return existing.id;
      }
      const sent = await target.send(body);
      await sent.pin().catch(() => undefined);
      // Drop Discord's "Padrinho pinned a message" notice so the channel only shows the agenda.
      const recent = await target.messages.fetch({ limit: 5 }).catch(() => null);
      const notice = recent?.find(
        (m) => m.type === MessageType.ChannelPinnedMessage && m.reference?.messageId === sent.id,
      );
      await notice?.delete().catch(() => undefined);
      return sent.id;
    },
  };
}

export type { RsvpSummary };
