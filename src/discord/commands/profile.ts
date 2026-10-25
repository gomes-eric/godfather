import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { matchClass, type CharacterRef } from '../../core/game-character.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { GameApiError, type CharacterSheet } from '../../services/game-character.service.js';
import { outcomeMessage } from '../interactions/confirmation.js';
import { profileCard } from '../profile-card.js';
import type { SlashCommand } from './types.js';

const t = ptBR.profile;

export const profileCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Show an Aion 2 character: combat power, item level and gear')
    .setDescriptionLocalizations({
      'pt-BR': 'Mostra um personagem do Aion 2: poder de combate, nível de item e equipamentos',
    })
    .addStringOption((o) =>
      o
        .setName('nome')
        .setDescription('Character name (default: yours, from #registro)')
        .setDescriptionLocalizations({
          'pt-BR': 'Nome do personagem (padrão: o seu, do #registro)',
        })
        .setMaxLength(30),
    )
    .addUserOption((o) =>
      o
        .setName('membro')
        .setDescription('A member who registered in #registro')
        .setDescriptionLocalizations({ 'pt-BR': 'Um membro que se registrou no #registro' }),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const name = interaction.options.getString('nome')?.trim();
    const user = interaction.options.getUser('membro');
    const actor = await ctx.resolveActor(interaction.user.id);

    // The card is public so it can be shown to the group; problems are only for the caller.
    await interaction.deferReply();
    const fail = async (content: string) => {
      await interaction.deleteReply();
      await interaction.followUp({ content: `⚠️ ${content}`, flags: MessageFlags.Ephemeral });
    };

    const outcome = await ctx
      .runAction({
        actor,
        action: 'character.read',
        preview: 'character.read',
        execute: async (): Promise<{ problem: string } | { sheet: CharacterSheet }> => {
          let ref: CharacterRef | Pick<CharacterRef, 'id' | 'serverId'> | null;
          if (name) {
            ref = await ctx.characters.find(name);
            if (!ref) return { problem: t.notFound(name) };
          } else {
            const userId = user?.id ?? interaction.user.id;
            const registered = ctx.registrations.get(userId);
            if (!registered) {
              return { problem: user ? t.memberNotRegistered(user.id) : t.notRegistered };
            }
            ref = { id: registered.characterId, serverId: registered.serverId };
          }
          return { sheet: await ctx.characters.sheet(ref) };
        },
      })
      .catch((error: unknown) => {
        if (error instanceof GameApiError) return null;
        throw error;
      });

    if (outcome === null) return fail(t.apiDown);
    if (outcome.status !== 'ok') {
      return fail(
        outcome.status === 'confirmation_required' ? outcome.preview : outcomeMessage(outcome),
      );
    }
    if ('problem' in outcome.value) return fail(outcome.value.problem);

    const { sheet } = outcome.value;
    const config = ctx.config.get();
    const classRole = matchClass(
      sheet.profile.className,
      config.roles.filter((role) => role.class),
    );
    await interaction.editReply({
      embeds: [
        profileCard(sheet, {
          ...(classRole?.emoji && { classEmoji: classRole.emoji }),
          ...(classRole?.color !== undefined && { color: classRole.color }),
          serverName: (config.settings as { game?: { server?: string } }).game?.server ?? 'Triniel',
        }),
      ],
    });
  },
};
