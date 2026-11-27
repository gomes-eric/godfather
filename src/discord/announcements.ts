import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageType,
  type MessageCreateOptions,
} from 'discord.js';
import type { ServerConfig } from '../config/schema.js';
import { localParts, unixSeconds as unix } from '../core/schedule.js';
import { ptBR } from '../i18n/pt-BR.js';
import type {
  AnnouncementPort,
  OccurrenceView,
  ReminderMessage,
} from '../services/event-calendar.js';
import { COLORS } from './colors.js';
import { customId } from './custom-id.js';
import type { GuildDirectory } from './directory.js';

const t = ptBR.events;
export const RSVP_PREFIX = 'rsvp:';

function rsvpButtons(occurrenceId: number) {
  const button = (status: 'yes' | 'maybe' | 'no', emoji: string, style: ButtonStyle) =>
    new ButtonBuilder()
      .setCustomId(customId(RSVP_PREFIX, occurrenceId, status))
      .setLabel(t.statusName[status])
      .setEmoji(emoji)
      .setStyle(style);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button('yes', '✅', ButtonStyle.Success),
    button('maybe', '❔', ButtonStyle.Secondary),
    button('no', '❌', ButtonStyle.Secondary),
  );
}

const CARD_COLORS = {
  soon: COLORS.amber,
  now: COLORS.crimson,
  cancelled: COLORS.slate,
  agenda: COLORS.brand,
};

function clock(date: Date, timeZone: string): string {
  const local = localParts(date, timeZone);
  return `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`;
}

export interface ReminderCard {
  /** "@everyone" when the event pings; embeds can't ping on their own. */
  content: string;
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline: boolean }[];
  footer: string;
  rsvpOpen: boolean;
}

export function reminderCard(message: ReminderMessage, timeZone: string): ReminderCard {
  const { occurrence: o, offsetMinutes, rsvp, classes, superseded } = message;
  const c = t.card;
  const fields: ReminderCard['fields'] = [
    { name: c.time, value: c.timeValue(clock(o.startsAt, timeZone)), inline: true },
  ];
  if (o.voiceChannelId)
    fields.push({ name: c.room, value: `<#${o.voiceChannelId}>`, inline: true });
  if (!o.cancelled && !superseded) {
    const breakdown = classes.map(({ name, count }) => `${count} ${name}`).join(', ');
    fields.push({
      name: c.attendance,
      value: [
        c.attendanceValue(rsvp.yes.length, rsvp.maybe.length, rsvp.no.length),
        ...(breakdown ? [`*${breakdown}*`] : []),
      ].join('\n'),
      inline: false,
    });
  }

  const headline = o.cancelled
    ? c.cancelled
    : superseded
      ? c.rescheduled(unix(o.startsAt))
      : offsetMinutes > 0
        ? c.soon(offsetMinutes, unix(o.startsAt))
        : c.now;
  return {
    content: o.ping ? '@everyone' : '',
    title: `${o.emoji}  ${o.title}`,
    description: [headline, ...(o.description ? ['', o.description] : [])].join('\n'),
    color: o.cancelled
      ? CARD_COLORS.cancelled
      : offsetMinutes > 0 || superseded
        ? CARD_COLORS.soon
        : CARD_COLORS.now,
    fields,
    footer: c.footer(o.occurrenceId),
    rsvpOpen: !o.cancelled,
  };
}

export function agendaDescription(items: OccurrenceView[], timeZone: string, now: Date): string {
  const a = t.agenda;
  if (items.length === 0) return [a.subtitle, t.agendaEmpty].join('\n\n');

  const dayKey = (date: Date) => {
    const p = localParts(date, timeZone);
    return `${p.year}-${p.month}-${p.day}`;
  };
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getTime() + 24 * 3600_000));

  const days = new Map<string, string[]>();
  for (const item of items) {
    const local = localParts(item.startsAt, timeZone);
    const date = `${String(local.day).padStart(2, '0')}/${String(local.month).padStart(2, '0')}`;
    const key = dayKey(item.startsAt);
    const weekday = a.weekdays[local.weekday] ?? local.weekday;
    const relative = key === today ? a.today : key === tomorrow ? a.tomorrow : null;
    const header = relative
      ? `🗓️ **${relative}** · ${weekday.toLowerCase()}, ${date}`
      : `🗓️ **${weekday}** · ${date}`;
    const line = [
      `\`${clock(item.startsAt, timeZone)}\` ${item.emoji} **${item.title}**`,
      ...(item.voiceChannelId ? [`<#${item.voiceChannelId}>`] : []),
      `<t:${unix(item.startsAt)}:R>`,
      `\`#${item.occurrenceId}\``,
    ].join(' · ');
    days.set(header, [...(days.get(header) ?? []), line]);
  }
  const body = [...days.entries()].map(([header, lines]) => [header, ...lines].join('\n'));
  return [a.subtitle, ...body].join('\n\n');
}

export function createDiscordAnnouncements(
  directory: GuildDirectory,
  config: () => ServerConfig,
): AnnouncementPort {
  const channel = (key: string) => {
    const found = directory.channelByKey(key);
    if (!found) throw new Error(`channel "${key}" not found; run /setup`);
    return found;
  };

  const payload = (message: ReminderMessage) => {
    const card = reminderCard(message, config().settings.timezone);
    const embed = new EmbedBuilder()
      .setTitle(card.title)
      .setDescription(card.description)
      .setColor(card.color)
      .addFields(card.fields)
      .setFooter({ text: card.footer })
      .setTimestamp(message.occurrence.startsAt);
    return {
      content: card.content,
      embeds: [embed],
      components: card.rsvpOpen ? [rsvpButtons(message.occurrence.occurrenceId)] : [],
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

    async upsertAgenda(messageId, items, now) {
      const target = channel(config().settings.eventDefaults.agendaChannel);
      const embed = new EmbedBuilder()
        .setTitle(t.agenda.title)
        .setColor(CARD_COLORS.agenda)
        .setDescription(agendaDescription(items, config().settings.timezone, now))
        .setFooter({ text: t.agenda.footer })
        .setTimestamp(now);
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
