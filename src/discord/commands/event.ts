import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { EventTemplatePatch } from '../../config/store.js';
import type { ServiceOutcome } from '../../core/action.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { parseDays } from '../../services/event.service.js';
import { outcomeMessage, runWithConfirmation } from '../interactions/confirmation.js';
import type { SlashCommand } from './types.js';

const t = ptBR.events;
const unix = (date: Date) => Math.floor(date.getTime() / 1000);

/** "21", "21h", "9:30", "21:00" → "HH:MM". Anything else is passed through for the schema to reject. */
export function normalizeClock(input: string): string {
  const match = input.trim().match(/^(\d{1,2})(?:[:h](\d{2})?)?h?$/);
  return match ? `${match[1]!.padStart(2, '0')}:${match[2] ?? '00'}` : input;
}

async function replyText(
  interaction: ChatInputCommandInteraction,
  outcome: ServiceOutcome<string>,
) {
  const content =
    outcome.status === 'confirmation_required' ? outcome.preview : outcomeMessage(outcome);
  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

export const eventCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Legion events and reminders')
    .setDescriptionLocalizations({ 'pt-BR': 'Eventos e avisos da legião' })
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a one-off event with automatic reminders')
        .setDescriptionLocalizations({ 'pt-BR': 'Cria um evento pontual com avisos automáticos' })
        .addStringOption((o) =>
          o.setName('title').setDescription('Title').setMaxLength(100).setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('when')
            .setDescription('e.g. "30/10 21:00", "sáb 21h", "amanhã 20:30" (Brasília time)')
            .setDescriptionLocalizations({
              'pt-BR': 'ex.: "30/10 21:00", "sáb 21h", "amanhã 20:30" (horário de Brasília)',
            })
            .setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('description').setDescription('Details').setMaxLength(1000),
        )
        .addChannelOption((o) =>
          o
            .setName('voice')
            .setDescription('Voice room for the event')
            .setDescriptionLocalizations({ 'pt-BR': 'Sala de voz do evento' })
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
        )
        .addStringOption((o) =>
          o.setName('emoji').setDescription('Emoji shown in reminders').setMaxLength(32),
        )
        .addBooleanOption((o) =>
          o
            .setName('ping')
            .setDescription('Ping @everyone in the reminders (default: yes)')
            .setDescriptionLocalizations({ 'pt-BR': 'Marca @everyone nos avisos (padrão: sim)' }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Events in the next 7 days')
        .setDescriptionLocalizations({ 'pt-BR': 'Eventos dos próximos 7 dias' }),
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Edit a one-off event')
        .setDescriptionLocalizations({ 'pt-BR': 'Edita um evento pontual' })
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Event number (see /event list)').setRequired(true),
        )
        .addStringOption((o) => o.setName('title').setDescription('New title').setMaxLength(100))
        .addStringOption((o) => o.setName('when').setDescription('New date/time'))
        .addStringOption((o) =>
          o.setName('description').setDescription('New details').setMaxLength(1000),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Cancel an event (or one date of a recurring one)')
        .setDescriptionLocalizations({
          'pt-BR': 'Cancela um evento (ou uma data de um recorrente)',
        })
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Event number (see /event list)').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('rsvps')
        .setDescription('Who confirmed attendance')
        .setDescriptionLocalizations({ 'pt-BR': 'Quem confirmou presença' })
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Event number (see /event list)').setRequired(true),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('template')
        .setDescription('Recurring events from server.yaml')
        .setDescriptionLocalizations({ 'pt-BR': 'Eventos recorrentes do server.yaml' })
        .addSubcommand((sub) => sub.setName('list').setDescription('List recurring events'))
        .addSubcommand((sub) =>
          sub
            .setName('enable')
            .setDescription('Turn a recurring event on')
            .addStringOption((o) =>
              o.setName('key').setDescription('Template key').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('disable')
            .setDescription('Turn a recurring event off')
            .addStringOption((o) =>
              o.setName('key').setDescription('Template key').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('edit')
            .setDescription('Change the time, days or title of a recurring event')
            .addStringOption((o) =>
              o.setName('key').setDescription('Template key').setRequired(true),
            )
            .addStringOption((o) => o.setName('time').setDescription('HH:MM (Brasília)'))
            .addStringOption((o) =>
              o.setName('days').setDescription('e.g. "seg qui sáb", "mon,thu,sat", "todo dia"'),
            )
            .addStringOption((o) => o.setName('title').setDescription('New title')),
        ),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const actor = await ctx.resolveActor(interaction.user.id);
    const opt = (name: string) => interaction.options.getString(name) ?? undefined;

    if (group === 'template') {
      if (sub === 'list') {
        const lines = ctx.config
          .get()
          .eventTemplates.map((tpl) =>
            t.templateLine(
              tpl.key,
              tpl.emoji,
              tpl.title,
              tpl.days.map((d) => t.weekdays[d] ?? d).join(' '),
              tpl.time,
              tpl.enabled,
            ),
          );
        const embed = new EmbedBuilder()
          .setTitle(t.templateListTitle)
          .setColor(0xa855f7)
          .setDescription(lines.join('\n') || t.agendaEmpty);
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      const key = interaction.options.getString('key', true);
      const patch: EventTemplatePatch = {};
      if (sub === 'enable') patch.enabled = true;
      if (sub === 'disable') patch.enabled = false;
      if (sub === 'edit') {
        const time = opt('time');
        const days = opt('days');
        const title = opt('title');
        if (time) patch.time = normalizeClock(time);
        if (title) patch.title = title;
        if (days) {
          const parsed = parseDays(days);
          if (!parsed) {
            await replyText(interaction, { status: 'rejected', reason: t.templateInvalid(days) });
            return;
          }
          patch.days = parsed;
        }
      }
      await replyText(interaction, await ctx.events.updateTemplate(actor, key, patch));
      return;
    }

    switch (sub) {
      case 'create': {
        const voice = interaction.options.getChannel('voice');
        const ping = interaction.options.getBoolean('ping');
        const description = opt('description');
        const emoji = opt('emoji');
        await replyText(
          interaction,
          await ctx.events.create(actor, {
            title: interaction.options.getString('title', true),
            when: interaction.options.getString('when', true),
            ...(description && { description }),
            ...(emoji && { emoji }),
            ...(voice && { voiceChannelId: voice.id }),
            ...(ping !== null && { ping }),
          }),
        );
        return;
      }
      case 'edit': {
        const title = opt('title');
        const when = opt('when');
        const description = opt('description');
        await replyText(
          interaction,
          await ctx.events.edit(actor, interaction.options.getInteger('id', true), {
            ...(title && { title }),
            ...(when && { when }),
            ...(description && { description }),
          }),
        );
        return;
      }
      case 'cancel': {
        const id = interaction.options.getInteger('id', true);
        await runWithConfirmation(interaction, ctx.confirmations, (confirm) =>
          ctx.events.cancel(actor, id, confirm),
        );
        return;
      }
      case 'list': {
        const outcome = await ctx.events.list(actor);
        if (outcome.status !== 'ok') {
          await replyText(interaction, outcome as ServiceOutcome<string>);
          return;
        }
        const lines = outcome.value.map((v) =>
          t.listLine(v.occurrenceId, v.emoji, v.title, unix(v.startsAt), v.templateKey !== null),
        );
        const embed = new EmbedBuilder()
          .setTitle(t.listTitle)
          .setColor(0xa855f7)
          .setDescription(lines.join('\n') || t.agendaEmpty);
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }
      case 'rsvps': {
        const outcome = await ctx.events.rsvps(actor, interaction.options.getInteger('id', true));
        if (outcome.status !== 'ok') {
          await replyText(interaction, outcome as ServiceOutcome<string>);
          return;
        }
        const { view, rsvp } = outcome.value;
        const names = (ids: string[]) => ids.map((id) => `<@${id}>`).join(', ') || t.nobody;
        const embed = new EmbedBuilder()
          .setTitle(t.rsvpsTitle(view.title))
          .setColor(0xa855f7)
          .addFields(
            { name: `✅ ${t.statusName.yes} (${rsvp.yes.length})`, value: names(rsvp.yes) },
            { name: `❔ ${t.statusName.maybe} (${rsvp.maybe.length})`, value: names(rsvp.maybe) },
            { name: `❌ ${t.statusName.no} (${rsvp.no.length})`, value: names(rsvp.no) },
          );
        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }
    }
  },
};
