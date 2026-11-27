import { z } from 'zod';
import { itemLabel } from '../../core/game-character.js';
import type { CharacterSheet } from '../../services/game-character.service.js';
import { text, fail, json, fromOutcome, member, type ToolKit } from './kit.js';

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
    async (args) => {
      const target = args.name
        ? { name: args.name }
        : args.member
          ? { userId: memberId(args.member) }
          : undefined;
      if (!target) return fail('Passe name ou member.');
      return fromOutcome(await s.characters.sheetFor(actor, target), (sheet) =>
        json(sheetJson(sheet)),
      );
    },
  );
  tool(
    'list_registered_characters',
    'Membros do Discord com personagem registrado, com classe, poder, legião vista na última conferência e se ainda estão no servidor.',
    {},
    async () => s.characters.registered(actor),
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
    async ({ status }) => s.recruitment.list(actor, status === 'all' ? undefined : status),
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
        const changed = await s.recruitment.changeKind(actor, args.id, args.kind);
        if (changed.status !== 'ok') return fromOutcome(changed, () => text(''));
      }
      return fromOutcome(await s.recruitment.decide(actor, args.id, args.approve), (a) =>
        text(
          `Ficha #${a.id} (${a.character?.name ?? a.userId}, ${s.recruitment.kindName(a)}): ${a.status === 'approved' ? 'aprovada' : 'recusada'}.`,
        ),
      );
    },
  );
  tool(
    'run_legion_check',
    'Roda agora a conferência diária: relê cada personagem no site oficial, atualiza classe e apelido, avisa no canal dos oficiais quem saiu ou entrou na legião e refaz o #ranking. Leva alguns segundos por membro.',
    {},
    async () =>
      fromOutcome(await s.legion.runNow(actor), ({ report }) =>
        text(report.length > 0 ? report.join('\n') : 'Conferência feita: nada mudou.'),
      ),
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
