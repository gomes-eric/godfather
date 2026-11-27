import { refusedRequest, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import { standingRoleIds } from '../core/standing.js';
import type { Actor } from '../core/actor.js';
import type { GuildDirectory } from '../discord/directory.js';
import { pickMember, pickRole } from '../discord/resolvers.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { GuildAdminPort, RoleFields, RoleView } from './guild-admin-port.js';

const t = ptBR.roles;

export interface RoleInput {
  name?: string;
  color?: string;
  hoist?: boolean;
  mentionable?: boolean;
}

interface Deps {
  guild: GuildAdminPort;
  directory: Pick<GuildDirectory, 'standingRoles'>;
  runAction: ActionRunner;
}

const parseColor = (color: string | undefined) =>
  color && /^#[0-9a-f]{6}$/i.test(color) ? Number.parseInt(color.slice(1), 16) : undefined;

function roleFields(input: RoleInput): RoleFields {
  const color = parseColor(input.color);
  return {
    ...(input.name && { name: input.name }),
    ...(color !== undefined && { color }),
    ...(input.hoist !== undefined && { hoist: input.hoist }),
    ...(input.mentionable !== undefined && { mentionable: input.mentionable }),
  };
}

export class RoleService {
  constructor(private readonly deps: Deps) {}

  private refusal(role: RoleView, forAssignment: boolean): string | null {
    if (role.managed) return t.integration;
    const top = this.deps.guild.botTopRolePosition();
    if (top !== null && role.position >= top) return t.aboveBot;
    if (forAssignment) {
      if (standingRoleIds(this.deps.directory.standingRoles()).has(role.id)) return t.tierRole;
    }
    return null;
  }

  async create(actor: Actor, input: RoleInput & { name: string }): Promise<ServiceOutcome<string>> {
    return this.deps.runAction({
      actor,
      action: 'role.create',
      target: input.name,
      params: { ...input },
      preview: input.name,
      execute: async () => {
        const role = await this.deps.guild.createRole({ ...roleFields(input), name: input.name });
        return t.created(role.name);
      },
    });
  }

  async edit(actor: Actor, roleInput: string, input: RoleInput): Promise<ServiceOutcome<string>> {
    const found = pickRole(this.deps.guild.roles(), roleInput);
    if (!found.ok) {
      return this.deps.runAction(
        refusedRequest(
          { actor, action: 'role.edit', target: roleInput, params: { ...input } },
          found.reason,
        ),
      );
    }
    const role = found.value;

    return this.deps.runAction({
      actor,
      action: 'role.edit',
      target: role.name,
      params: { roleId: role.id, ...input },
      preview: role.name,
      check: () => this.refusal(role, false),
      execute: async () => {
        await this.deps.guild.editRole(role.id, roleFields(input));
        return t.edited(input.name ?? role.name);
      },
    });
  }

  async delete(actor: Actor, roleInput: string, confirm: boolean): Promise<ServiceOutcome<string>> {
    const found = pickRole(this.deps.guild.roles(), roleInput);
    if (!found.ok) {
      return this.deps.runAction(
        refusedRequest({ actor, action: 'role.delete', target: roleInput }, found.reason),
      );
    }
    const role = found.value;

    return this.deps.runAction({
      actor,
      action: 'role.delete',
      target: role.name,
      params: { roleId: role.id },
      confirm,
      preview: t.deletePreview(role.name, role.memberCount),
      check: () => this.refusal(role, false),
      execute: async () => {
        await this.deps.guild.deleteRole(role.id);
        return t.deleted(role.name);
      },
    });
  }

  async setAssignment(
    actor: Actor,
    memberInput: string,
    roleInput: string,
    assign: boolean,
  ): Promise<ServiceOutcome<string>> {
    const refuse = (reason: string) =>
      this.deps.runAction(
        refusedRequest(
          {
            actor,
            action: 'role.assign',
            target: `${roleInput} → ${memberInput}`,
            params: { assign },
          },
          reason,
        ),
      );
    const member = pickMember(this.deps.guild.members(), memberInput);
    if (!member.ok) return refuse(member.reason);
    const role = pickRole(this.deps.guild.roles(), roleInput);
    if (!role.ok) return refuse(role.reason);

    const name = member.value.displayName;
    const { id: roleId, name: roleName } = role.value;
    return this.deps.runAction({
      actor,
      action: 'role.assign',
      target: `${roleName} → ${name}`,
      params: { roleId, userId: member.value.id, assign },
      preview: roleName,
      check: () => this.refusal(role.value, true),
      execute: async () => {
        if (assign) {
          await this.deps.guild.addRole(member.value.id, roleId);
          return t.assigned(roleName, name);
        }
        await this.deps.guild.removeRole(member.value.id, roleId);
        return t.removed(roleName, name);
      },
    });
  }
}
