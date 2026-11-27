import { z } from 'zod';
import { member, confirm, type ToolKit } from './kit.js';

export function registerRoleTools({ tool, s, actor }: ToolKit): void {
  const roleFields = {
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional()
      .describe('#RRGGBB'),
    hoist: z.boolean().optional().describe('Exibir separadamente na lista de membros'),
    mentionable: z.boolean().optional(),
  };
  tool(
    'create_role',
    'Cria um cargo avulso sem permissões especiais.',
    { name: z.string().min(1).max(100), ...roleFields },
    async (args) => s.roles.create(actor, args),
  );
  tool(
    'edit_role',
    'Edita nome/cor/exibição de um cargo.',
    { role: z.string(), name: z.string().min(1).max(100).optional(), ...roleFields },
    async ({ role, ...edit }) => s.roles.edit(actor, role, edit),
  );
  tool('delete_role', 'Apaga um cargo (destrutivo).', { role: z.string(), confirm }, async (args) =>
    s.roles.delete(actor, args.role, args.confirm === true),
  );
  tool(
    'assign_role',
    'Dá um cargo (não da hierarquia) a um membro.',
    { member, role: z.string() },
    async (args) => s.roles.setAssignment(actor, args.member, args.role, true),
  );
  tool(
    'remove_role',
    'Remove um cargo (não da hierarquia) de um membro.',
    { member, role: z.string() },
    async (args) => s.roles.setAssignment(actor, args.member, args.role, false),
  );
}
