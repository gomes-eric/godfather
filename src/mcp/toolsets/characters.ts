import { z } from 'zod';
import { findMember } from '../../discord/resolvers.js';
import { ptBR } from '../../i18n/pt-BR.js';
import { classRoles } from '../../config/schema.js';
import { itemLabel, sameLegion } from '../../core/game-character.js';
import { byCombatPower } from '../../core/legion-check.js';
import type { CharacterSheet } from '../../services/game-character.service.js';
import { text, fromOutcome, member, gameFailure, type ToolKit } from './kit.js';

export function registerCharacterTools({ tool, read, memberId, s, actor }: ToolKit): void {
  const sheetJson = ({ profile, equipment }: CharacterSheet) => ({
    ...profile,
    equipment: equipment.map((item) => ({ slot: item.slot, item: itemLabel(item) })),
  });
  tool(
    'get_character',
    'Personagem do Aion 2 no site oficial: classe, nível, poder de combate, nível de item, legião e equipamentos. Passe o nome do personagem ou um membro do Discord com personagem registrado.',
    {
      name: z.string().optional().describe('Nome exato do personagem no jogo'),
      member: z.string().optional().describe('Membro do Discord com personagem registrado'),
    },
    async (args) =>
      read('character.read', async (): Promise<string | ReturnType<typeof sheetJson>> => {
        if (args.name) {
          const ref = await s.characters.find(args.name);
          return ref ? sheetJson(await s.characters.sheet(ref)) : ptBR.profile.notFound(args.name);
        }
        if (!args.member) return 'Passe name ou member.';
        const found = findMember(s.guild, args.member);
        if (!found.ok) return found.reason;
        const registered = s.registrations.get(found.value.id);
        if (!registered) return ptBR.profile.memberNotRegistered(found.value.id);
        return sheetJson(
          await s.characters.sheet({
            id: registered.characterId,
            serverId: registered.serverId,
          }),
        );
      }).catch(gameFailure),
  );
  tool(
    'list_registered_characters',
    'Membros do Discord com personagem registrado, com classe, poder, legião vista na última conferência e se ainda estão no servidor.',
    {},
    async () =>
      read('character.read', async () => {
        const { legion } = s.config.get().settings.characters;
        const classes = new Map(classRoles(s.config.get()).map((r) => [r.key, r.name]));
        return s.registrations
          .all()
          .sort(byCombatPower)
          .map((row) => {
            const member = s.guild.members.cache.get(row.userId);
            return {
              character: row.name,
              class: classes.get(row.classKey) ?? row.classKey,
              combatPower: row.combatPower,
              itemLevel: row.itemLevel,
              legion: row.legion || null,
              inLegion: sameLegion(row.legion, legion),
              member: member?.displayName ?? null,
              userId: row.userId,
              checkedAt: row.checkedAt?.toISOString() ?? null,
            };
          });
      }),
  );
  tool(
    'register_character',
    'Registra o personagem de um membro, como uma ficha aprovada: cargo da classe, apelido "emoji Nome", personagem guardado para /perfil e #ranking, e Soldado se ele for Visitante.',
    {
      member,
      character: z.string().describe('Nome exato do personagem no jogo'),
      confirm: z
        .boolean()
        .optional()
        .describe('true para passar um personagem que já é de outra conta (ela vira Restrito)'),
    },
    async (args) =>
      s.registration.register(actor, memberId(args.member), args.character, args.confirm === true),
  );
  tool(
    'list_applications',
    'Fichas de recrutamento (as mais novas primeiro), com o id usado em decide_application.',
    { status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending') },
    async ({ status }) =>
      read('recruit.read', async () =>
        s.applications.list(status === 'all' ? undefined : status).map((a) => ({
          id: a.id,
          status: a.status,
          kind: a.kind,
          picked: a.requestedKind,
          origin: a.origin,
          allianceLegion: a.allianceLegion,
          characterTakenBy: a.characterTakenBy
            ? (s.guild.members.cache.get(a.characterTakenBy)?.displayName ?? a.characterTakenBy)
            : null,
          character: a.character?.name ?? null,
          class: a.character?.className ?? null,
          level: a.character?.level ?? null,
          combatPower: a.character?.combatPower ?? null,
          itemLevel: a.character?.itemLevel ?? null,
          legion: a.character?.legion || null,
          member: s.guild.members.cache.get(a.userId)?.displayName ?? a.userId,
          createdAt: a.createdAt.toISOString(),
          decidedBy: a.decidedBy,
        })),
      ),
  );
  tool(
    'decide_application',
    'Aprova ou recusa uma ficha (ou uma análise da conferência diária). Aprovar dá o cargo do tipo da ficha: member = Soldado (registra o personagem), ally = Aliado da legião do personagem (aliança nova só Comandante, e cria a aliança), partner = Parceiro, restricted = Restrito. Passe kind para trocar o tipo antes de aprovar. Recusar uma análise devolve o cargo anterior.',
    {
      id: z.number().int(),
      approve: z.boolean(),
      kind: z.enum(['member', 'ally', 'partner', 'restricted']).optional(),
    },
    async (args) => {
      if (args.kind) {
        const changed = await s.recruitmentDesk.changeKind(actor, args.id, args.kind);
        if (changed.status !== 'ok') return fromOutcome(changed, () => text(''));
      }
      return fromOutcome(await s.recruitmentDesk.decide(actor, args.id, args.approve), (a) =>
        text(
          `Ficha #${a.id} (${a.character?.name ?? a.userId}, ${s.recruitmentDesk.kindName(a)}): ${a.status === 'approved' ? 'aprovada' : 'recusada'}.`,
        ),
      );
    },
  );
  tool(
    'run_legion_check',
    'Roda agora a conferência diária: relê cada personagem no site oficial, atualiza classe e apelido, avisa no canal dos oficiais quem saiu ou entrou na legião e refaz o #ranking. Leva alguns segundos por membro.',
    {},
    async () =>
      read('legion.check', async () => {
        const report = await s.legion.check();
        return report.length > 0 ? report.join('\n') : 'Conferência feita: nada mudou.';
      }),
  );
  tool(
    'refresh_ranking',
    'Refaz o card do #ranking com os números guardados (sem consultar o site oficial).',
    {},
    async () =>
      read('legion.check', async () => {
        await s.ranking.refresh();
        return '#ranking atualizado.';
      }),
  );

  tool(
    'preview_news',
    'Resume com a IA as últimas notícias do jogo na Steam e posta as prévias no canal dos oficiais (sem marcar ninguém), para conferir os resumos antes de irem ao #noticias.',
    {
      count: z.number().int().min(1).max(5).default(3),
      channel: z.string().default('officers').describe('Chave do canal no server.yaml'),
    },
    async (args) =>
      s.runAction({
        actor,
        action: 'news.preview',
        target: args.channel,
        params: { count: args.count },
        preview: 'news.preview',
        execute: async () => (await s.news.preview(args.count, args.channel)).join('\n'),
      }),
  );
}
