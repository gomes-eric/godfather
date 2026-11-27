import type { Guild } from 'discord.js';
import type { ConfigStore } from '../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { allianceKey, findAlliance } from '../core/alliances.js';
import { sameLegion } from '../core/game-character.js';
import { RESTRICTED } from '../core/standing.js';
import type { GuildDirectory } from '../discord/directory.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import type { Roster } from './roster.service.js';
import type { SetupService } from './setup.service.js';
import { ownLegion } from '../config/views.js';

const t = ptBR.alliances;

export interface AllianceSummary {
  key: string;
  legion: string;
  members: number;
}

interface Deps {
  guild: Guild;
  config: ConfigStore;
  directory: GuildDirectory;
  setup: SetupService;
  roster: Roster;
  runAction: ActionRunner;
  logger: Logger;
}

export class AllianceService {
  constructor(private readonly deps: Deps) {}

  async list(actor: Actor): Promise<ServiceOutcome<AllianceSummary[]>> {
    return this.deps.runAction({
      actor,
      action: 'alliance.read',
      preview: 'alliance.read',
      execute: async () =>
        this.deps.config.get().alliances.map((alliance) => {
          const id = this.deps.directory.roleId(alliance.key);
          const role = id ? this.deps.guild.roles.cache.get(id) : undefined;
          return { key: alliance.key, legion: alliance.legion, members: role?.members.size ?? 0 };
        }),
    });
  }

  async add(actor: Actor, legion: string): Promise<ServiceOutcome<string>> {
    const { config } = this.deps;
    const name = legion.trim().replace(/\s+/g, ' ');
    if (!name) return rejected(t.emptyName);
    if (sameLegion(name, ownLegion(config.get()))) return rejected(t.ownLegion);
    const existing = findAlliance(config.get().alliances, name);
    if (existing) return rejected(t.exists(existing.legion));
    if (!config.get().settings.allyRole) return rejected(ptBR.members.noAllyRole);

    const key = allianceKey(name, [
      ...config.get().roles.map((r) => r.key),
      ...config.get().alliances.map((a) => a.key),
    ]);
    const outcome = await this.deps.runAction({
      actor,
      action: 'alliance.add',
      target: name,
      params: { legion: name, key },
      preview: t.addPreview(name),
      execute: async () => {
        config.addAlliance({ key, legion: name });
        const result = await this.deps.setup.syncRoles([key]);
        if (result.failures.length === 0) return true;
        this.deps.logger.warn({ failures: result.failures }, 'alliance role not created');
        config.removeAlliance(key);
        return false;
      },
    });
    if (outcome.status !== 'ok') return outcome;
    return outcome.value
      ? { status: 'ok', value: t.added(name) }
      : rejected(t.roleNotCreated(name));
  }

  async remove(actor: Actor, legion: string, confirm: boolean): Promise<ServiceOutcome<string>> {
    const alliance = findAlliance(this.deps.config.get().alliances, legion);
    if (!alliance) return rejected(ptBR.members.unknownAlliance(legion));
    const roleId = this.deps.directory.roleId(alliance.key);
    const allies = roleId
      ? [...(this.deps.guild.roles.cache.get(roleId)?.members.values() ?? [])]
      : [];

    return this.deps.runAction({
      actor,
      action: 'alliance.remove',
      target: alliance.legion,
      params: { legion: alliance.legion, key: alliance.key, allies: allies.length },
      confirm,
      preview: t.removePreview(alliance.legion, allies.length),
      execute: async () => {
        let restricted = 0;
        for (const member of allies) {
          const outcome = await this.deps.roster.change(actor, member.id, {
            to: RESTRICTED,
            cause: { kind: 'allianceEnded', legion: alliance.legion },
          });
          if (outcome.status === 'ok') restricted++;
        }
        this.deps.config.removeAlliance(alliance.key);
        await this.deps.setup.syncRoles([alliance.key]);
        return t.removed(alliance.legion, restricted);
      },
    });
  }
}
