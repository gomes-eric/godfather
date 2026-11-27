import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { CharacterRef } from '../../core/game-character.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { GameApiError, type CharacterSheet } from '../../services/game-character.service.js';
import { characterCard, gearMenu } from '../profile-card.js';
import { failureText } from '../replies.js';
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
        .setDescription('Character name (default: your registered one)')
        .setDescriptionLocalizations({
          'pt-BR': 'Nome do personagem (padrão: o seu, registrado)',
        })
        .setMaxLength(30),
    )
    .addUserOption((o) =>
      o
        .setName('membro')
        .setDescription('A member with a registered character')
        .setDescriptionLocalizations({ 'pt-BR': 'Um membro com personagem registrado' }),
    )
    .toJSON(),

  async execute(interaction, ctx) {
    const name = interaction.options.getString('nome')?.trim();
    const user = interaction.options.getUser('membro');
    const actor = await ctx.resolveActor(interaction.user.id);

    await interaction.deferReply();
    const fail = async (content: string) => {
      await interaction.deleteReply();
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
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

    if (outcome === null) return fail(`⚠️ ${t.apiDown}`);
    if (outcome.status !== 'ok') return fail(failureText(outcome));
    if ('problem' in outcome.value) return fail(`⚠️ ${outcome.value.problem}`);

    const { sheet } = outcome.value;
    await interaction.editReply({
      embeds: [characterCard(sheet, ctx.config.get())],
      components: gearMenu(sheet),
    });
  },
};
