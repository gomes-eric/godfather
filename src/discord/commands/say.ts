import {
  ChannelType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ModalSubmitInteraction,
} from 'discord.js';
import { authorize } from '../../core/permissions.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { outcomeMessage, runWithConfirmation } from '../interactions/confirmation.js';
import type { CommandContext, SlashCommand } from './types.js';

const t = ptBR.say;
/** `say:<channelId>:<1|0 allow mentions>`: the form's id carries the command's choices. */
const SAY_MODAL_PREFIX = 'say:';
const TITLE_FIELD = 'title';
const TEXT_FIELD = 'text';
/** An embed description holds 4096 characters; a plain message 2000 (longer goes as embed). */
const MAX_TEXT = 4000;

function sayModal(channelId: string, allowMentions: boolean): ModalBuilder {
  const title = new TextInputBuilder()
    .setCustomId(TITLE_FIELD)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(256)
    .setPlaceholder(t.titlePlaceholder);
  const text = new TextInputBuilder()
    .setCustomId(TEXT_FIELD)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(MAX_TEXT)
    .setPlaceholder(t.textPlaceholder);
  return new ModalBuilder()
    .setCustomId(`${SAY_MODAL_PREFIX}${channelId}:${allowMentions ? 1 : 0}`)
    .setTitle(t.modalTitle)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(t.titleLabel)
        .setDescription(t.titleHint)
        .setTextInputComponent(title),
      new LabelBuilder().setLabel(t.textLabel).setTextInputComponent(text),
    );
}

export const sayCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Send a message as Padrinho')
    .setDescriptionLocalizations({ 'pt-BR': 'Envia uma mensagem como o Padrinho' })
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Where to send it (text channels and voice channel chats)')
        .setDescriptionLocalizations({
          'pt-BR': 'Onde enviar (canais de texto e chat das salas de voz)',
        })
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildVoice,
          ChannelType.GuildStageVoice,
        )
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName('text')
        .setDescription('The message; leave empty to write it in a form with line breaks')
        .setDescriptionLocalizations({
          'pt-BR': 'A mensagem; deixe vazio para escrever num formulário com quebras de linha',
        })
        .setMaxLength(2000),
    )
    .addStringOption((o) =>
      o
        .setName('title')
        .setDescription('Send as an embed with this title')
        .setDescriptionLocalizations({ 'pt-BR': 'Envia como embed com este título' })
        .setMaxLength(256),
    )
    .addBooleanOption((o) =>
      o
        .setName('allow-mentions')
        .setDescription('Let @everyone/@roles/@users in the text ping (default: no)')
        .setDescriptionLocalizations({
          'pt-BR': 'Deixa @everyone/@cargos/@pessoas no texto notificarem (padrão: não)',
        }),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const channel = interaction.options.getChannel('channel', true);
    const rawText = interaction.options.getString('text');
    const title = interaction.options.getString('title');
    const allowMentions = interaction.options.getBoolean('allow-mentions') ?? false;
    const actor = await ctx.resolveActor(interaction.user.id);

    if (rawText === null) {
      // Check before opening the form, so nobody writes a long text only to be refused.
      const allowed = authorize(actor.tier, 'message.send');
      if (!allowed.allowed) {
        await interaction.reply({
          content: ptBR.errors.denied(allowed.requiredTier),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.showModal(sayModal(channel.id, allowMentions));
      return;
    }

    // Slash command text can't contain real line breaks, so accept a literal "\n".
    const text = rawText.replaceAll('\\n', '\n');
    await runWithConfirmation(interaction, ctx.confirmations, () =>
      ctx.messages.send(actor, channel.id, text, {
        allowMentions,
        ...(title !== null && { title }),
      }),
    );
  },
};

/** The /say form. Returns false for any other modal. */
export async function handleSayModal(
  interaction: ModalSubmitInteraction,
  ctx: CommandContext,
): Promise<boolean> {
  if (!interaction.customId.startsWith(SAY_MODAL_PREFIX)) return false;
  const [channelId, mentions] = interaction.customId.slice(SAY_MODAL_PREFIX.length).split(':');
  if (!channelId) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const title = interaction.fields.getTextInputValue(TITLE_FIELD).trim();
  const text = interaction.fields.getTextInputValue(TEXT_FIELD);
  const actor = await ctx.resolveActor(interaction.user.id);
  const outcome = await ctx.messages.send(actor, channelId, text, {
    allowMentions: mentions === '1',
    ...(title && { title }),
  });
  await interaction.editReply(
    outcome.status === 'confirmation_required' ? outcome.preview : outcomeMessage(outcome),
  );
  return true;
}
