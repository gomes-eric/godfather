import { z } from 'zod';
import { SNOWFLAKE } from '../../core/resolve.js';
import { TIERS } from '../../core/tiers.js';
import { findMember } from '../../discord/resolvers.js';
import { member, confirm, reason, NotFound, type ToolKit } from './kit.js';

export function registerMemberTools({ tool, memberId, s, actor }: ToolKit): void {
  const rank = z.enum(TIERS).optional().describe('visitor | soldier | officer');
  tool(
    'promote_member',
    'Promove um membro (Visitante → Soldado → Oficial).',
    { member, rank },
    async (args) => s.roster.promote(actor, memberId(args.member), args.rank),
  );
  tool(
    'demote_member',
    'Rebaixa um membro um nível (destrutivo).',
    { member, rank, confirm },
    async (args) => s.roster.demote(actor, memberId(args.member), args.rank, args.confirm === true),
  );
  tool(
    'partner_member',
    'Torna Parceiro (amigo que não joga) qualquer membro, tirando o cargo anterior (Soldado, Aliado, Restrito...). Com remove=true tira o Parceiro e volta para Visitante.',
    { member, remove: z.boolean().optional().describe('true para tirar o cargo') },
    async (args) => s.roster.partner(actor, memberId(args.member), args.remove === true),
  );
  tool(
    'ally_member',
    'Torna alguém Aliado de uma aliança que já existe (veja list_alliances), tirando o cargo anterior. Aliado vê os mesmos canais de um Soldado.',
    { member, legion: z.string().describe('A legião aliada') },
    async (args) => {
      return s.roster.ally(actor, memberId(args.member), args.legion);
    },
  );
  tool(
    'restrict_member',
    'Restringe alguém: tira o cargo atual e dá Restrito (só vê o #geral). O motivo vai para o canal dos oficiais. promote_member, partner_member ou ally_member tiram o Restrito.',
    { member, reason: z.string().min(1).max(300).describe('Motivo (aparece para os oficiais)') },
    async (args) => s.roster.restrict(actor, memberId(args.member), args.reason),
  );
  tool('list_alliances', 'As legiões aliadas e quantos aliados cada uma tem.', {}, async () =>
    s.alliances.list(actor),
  );
  tool(
    'add_alliance',
    'Cria uma aliança com uma legião (só Comandante): entra no server.yaml e ganha um cargo com o nome da legião, acima de Aliado.',
    { legion: z.string().min(1).max(100).describe('Nome da legião, exatamente como no jogo') },
    async (args) => s.alliances.add(actor, args.legion),
  );
  tool(
    'remove_alliance',
    'Desfaz uma aliança (destrutivo, só Comandante): os aliados dela viram Restrito e o cargo da legião é apagado.',
    { legion: z.string().describe('A legião aliada'), confirm },
    async (args) => s.alliances.remove(actor, args.legion, args.confirm === true),
  );
  tool(
    'kick_member',
    'Expulsa um membro (destrutivo).',
    { member, reason, confirm },
    async (args) =>
      s.moderation.kick(actor, memberId(args.member), args.reason ?? null, args.confirm === true),
  );
  tool(
    'ban_member',
    'Bane alguém (destrutivo). Não apaga mensagens, a menos que deleteMessagesHours seja passado.',
    {
      member: z.string().describe('Membro (nome, menção) ou ID de quem já saiu'),
      reason,
      deleteMessagesHours: z.number().int().min(0).max(168).optional(),
      confirm,
    },
    async (args) => {
      const found = findMember(s.guild, args.member);
      // Someone who already left can still be banned by id.
      const id = found.ok ? found.value.id : SNOWFLAKE.test(args.member) ? args.member : null;
      if (!id) throw new NotFound(found.ok ? '' : found.reason);
      return s.moderation.ban(
        actor,
        id,
        args.reason ?? null,
        args.deleteMessagesHours ?? 0,
        args.confirm === true,
      );
    },
  );
  tool(
    'unban_member',
    'Desbane alguém pelo ID.',
    { userId: z.string().regex(SNOWFLAKE), reason },
    async (args) => s.moderation.unban(actor, args.userId, args.reason ?? null),
  );
  tool(
    'timeout_member',
    'Silencia um membro por N minutos (0 remove o timeout).',
    { member, minutes: z.number().int().min(0).max(40320), reason },
    async (args) =>
      s.moderation.timeout(actor, memberId(args.member), args.minutes, args.reason ?? null),
  );
}
