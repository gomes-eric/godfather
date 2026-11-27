import { refusedRequest, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import type { ManagedObjectStore } from '../db/managed-objects.js';
import { pickChannel } from '../discord/resolvers.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { GuildAdminPort } from './guild-admin-port.js';

const t = ptBR.channels;

export interface NewChannel {
  name: string;
  type: 'text' | 'voice';
  category?: string;
  topic?: string;
  userLimit?: number;
}

export interface ChannelEdit {
  name?: string;
  topic?: string;
  userLimit?: number;
}

interface Deps {
  guild: GuildAdminPort;
  managed: Pick<ManagedObjectStore, 'all'>;
  runAction: ActionRunner;
}

export class ChannelService {
  constructor(private readonly deps: Deps) {}

  async create(actor: Actor, input: NewChannel): Promise<ServiceOutcome<string>> {
    const { guild, runAction } = this.deps;
    let parentId: string | undefined;
    if (input.category) {
      const category = pickChannel(
        guild.channels(),
        input.category,
        (c) => c.kind === 'category',
        'category',
      );
      if (!category.ok) {
        return runAction(
          refusedRequest(
            { actor, action: 'channel.create', target: input.name, params: { ...input } },
            category.reason,
          ),
        );
      }
      parentId = category.value.id;
    }

    return runAction({
      actor,
      action: 'channel.create',
      target: input.name,
      params: { ...input },
      preview: input.name,
      execute: async () => {
        const channel = await guild.createChannel({
          name: input.name,
          kind: input.type,
          ...(parentId && { parentId }),
          ...(input.type === 'text' && input.topic && { topic: input.topic }),
          ...(input.type === 'voice' &&
            input.userLimit !== undefined && { userLimit: input.userLimit }),
        });
        return t.created(channel.name, channel.id);
      },
    });
  }

  async edit(
    actor: Actor,
    channelInput: string,
    input: ChannelEdit,
  ): Promise<ServiceOutcome<string>> {
    const found = pickChannel(
      this.deps.guild.channels(),
      channelInput,
      (c) => c.kind !== 'category',
    );
    if (!found.ok) {
      return this.deps.runAction(
        refusedRequest(
          { actor, action: 'channel.edit', target: channelInput, params: { ...input } },
          found.reason,
        ),
      );
    }
    const channel = found.value;

    return this.deps.runAction({
      actor,
      action: 'channel.edit',
      target: channel.name,
      params: { channelId: channel.id, ...input },
      preview: channel.name,
      execute: async () => {
        await this.deps.guild.editChannel(channel.id, {
          ...(input.name && { name: input.name }),
          ...(input.topic !== undefined && channel.hasTopic && { topic: input.topic }),
          ...(input.userLimit !== undefined &&
            channel.kind === 'voice' && { userLimit: input.userLimit }),
        });
        return t.edited(channel.id);
      },
    });
  }

  async delete(
    actor: Actor,
    channelInput: string,
    confirm: boolean,
  ): Promise<ServiceOutcome<string>> {
    const found = pickChannel(this.deps.guild.channels(), channelInput);
    if (!found.ok) {
      return this.deps.runAction(
        refusedRequest({ actor, action: 'channel.delete', target: channelInput }, found.reason),
      );
    }
    const channel = found.value;
    const all = this.deps.managed.all();
    const managed = [...all.channel.values(), ...all.category.values()].some(
      (entry) => entry.discordId === channel.id,
    );

    return this.deps.runAction({
      actor,
      action: 'channel.delete',
      target: channel.name,
      params: { channelId: channel.id, managed },
      confirm,
      preview: t.deletePreview(channel.name, managed),
      execute: async () => {
        await this.deps.guild.deleteChannel(channel.id);
        return t.deleted(channel.name);
      },
    });
  }
}
