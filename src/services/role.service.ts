import type { Guild, Role } from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import type { GuildDirectory } from '../discord/directory.js';
import { findMember, findRole } from '../discord/resolvers.js';
import { ptBR } from '../i18n/pt-BR.js';

const t = ptBR.roles;

export interface RoleInput {
  name?: string;
  /** "#RRGGBB". */
  color?: string;
  hoist?: boolean;
  mentionable?: boolean;
}

interface Deps {
  guild: Guild;
  directory: GuildDirectory;
  config: ConfigStore;
  runAction: ActionRunner;
}

const parseColor = (color: string | undefined) =>
  color && /^#[0-9a-f]{6}$/i.test(color) ? Number.parseInt(color.slice(1), 16) : undefined;

/** Ad-hoc roles and role assignment (the legion hierarchy goes through MemberService). */
export class RoleService {
  constructor(private readonly deps: Deps) {}

  /** Why a role can't be touched here, if it can't. */
  private refuse(role: Role, forAssignment: boolean): string | null {
    if (role.managed) return t.integration;
    const me = this.deps.guild.members.me;
    if (me && role.position >= me.roles.highest.position) return t.aboveBot;
    if (forAssignment) {
      const tierIds = new Set(Object.values(this.deps.directory.tierRoleIds()));
      const visitorKey = this.deps.config.get().roles.find((r) => r.tier === 'visitor')?.key;
      const visitorId = visitorKey ? this.deps.directory.roleId(visitorKey) : undefined;
      if (tierIds.has(role.id) || role.id === visitorId) return t.tierRole;
    }
    return null;
  }

  async create(actor: Actor, input: RoleInput & { name: string }): Promise<ServiceOutcome<string>> {
    const color = parseColor(input.color);
    return this.deps.runAction({
      actor,
      action: 'role.create',
      target: input.name,
      params: { ...input },
      preview: input.name,
      execute: async () => {
        const role = await this.deps.guild.roles.create({
          name: input.name,
          ...(color !== undefined && { colors: { primaryColor: color } }),
          ...(input.hoist !== undefined && { hoist: input.hoist }),
          ...(input.mentionable !== undefined && { mentionable: input.mentionable }),
          permissions: [],
        });
        return t.created(role.name);
      },
    });
  }

  async edit(actor: Actor, roleInput: string, input: RoleInput): Promise<ServiceOutcome<string>> {
    const found = findRole(this.deps.guild, roleInput);
    if (!found.ok) return rejected(found.reason);
    const role = found.value;
    const refusal = this.refuse(role, false);
    if (refusal) return rejected(refusal);
    const color = parseColor(input.color);

    return this.deps.runAction({
      actor,
      action: 'role.edit',
      target: role.name,
      params: { roleId: role.id, ...input },
      preview: role.name,
      execute: async () => {
        await role.edit({
          ...(input.name && { name: input.name }),
          ...(color !== undefined && { colors: { primaryColor: color } }),
          ...(input.hoist !== undefined && { hoist: input.hoist }),
          ...(input.mentionable !== undefined && { mentionable: input.mentionable }),
        });
        return t.edited(input.name ?? role.name);
      },
    });
  }

  async delete(actor: Actor, roleInput: string, confirm: boolean): Promise<ServiceOutcome<string>> {
    const found = findRole(this.deps.guild, roleInput);
    if (!found.ok) return rejected(found.reason);
    const role = found.value;
    const refusal = this.refuse(role, false);
    if (refusal) return rejected(refusal);

    return this.deps.runAction({
      actor,
      action: 'role.delete',
      target: role.name,
      params: { roleId: role.id },
      confirm,
      preview: t.deletePreview(role.name, role.members.size),
      execute: async () => {
        await role.delete();
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
    const member = findMember(this.deps.guild, memberInput);
    if (!member.ok) return rejected(member.reason);
    const role = findRole(this.deps.guild, roleInput);
    if (!role.ok) return rejected(role.reason);
    const refusal = this.refuse(role.value, true);
    if (refusal) return rejected(refusal);

    const name = member.value.displayName;
    return this.deps.runAction({
      actor,
      action: 'role.assign',
      target: `${role.value.name} → ${name}`,
      params: { roleId: role.value.id, userId: member.value.id, assign },
      preview: role.value.name,
      execute: async () => {
        if (assign) {
          await member.value.roles.add(role.value);
          return t.assigned(role.value.name, name);
        }
        await member.value.roles.remove(role.value);
        return t.removed(role.value.name, name);
      },
    });
  }
}
