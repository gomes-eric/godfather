import { ChannelType, type Guild } from 'discord.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import type { ManagedObjectStore } from '../db/managed-objects.js';
import { findCategory, findChannel } from '../discord/resolvers.js';
import { ptBR } from '../i18n/pt-BR.js';

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

/**
 * Ad-hoc channels (e.g. "a fixed voice room for Saturday's raid"). The planned layout belongs in
 * server.yaml; channels made here aren't managed by /setup.
 */
export class ChannelService {
  constructor(
    private readonly deps: { guild: Guild; managed: ManagedObjectStore; runAction: ActionRunner },
  ) {}

  async create(actor: Actor, input: NewChannel): Promise<ServiceOutcome<string>> {
    const { guild, runAction } = this.deps;
    let parentId: string | undefined;
    if (input.category) {
      const category = findCategory(guild, input.category);
      if (!category.ok) return rejected(category.reason);
      parentId = category.value.id;
    }

    return runAction({
      actor,
      action: 'channel.create',
      target: input.name,
      params: { ...input },
      preview: input.name,
      execute: async () => {
        const channel = await guild.channels.create({
          name: input.name,
          type: input.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
          ...(parentId && { parent: parentId }),
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
    const found = findChannel(
      this.deps.guild,
      channelInput,
      (c) => c.type !== ChannelType.GuildCategory,
    );
    if (!found.ok) return rejected(found.reason);
    const channel = found.value;

    return this.deps.runAction({
      actor,
      action: 'channel.edit',
      target: channel.name,
      params: { channelId: channel.id, ...input },
      preview: channel.name,
      execute: async () => {
        if (!('edit' in channel)) throw new Error('channel cannot be edited');
        await channel.edit({
          ...(input.name && { name: input.name }),
          ...(input.topic !== undefined && 'topic' in channel && { topic: input.topic }),
          ...(input.userLimit !== undefined &&
            channel.type === ChannelType.GuildVoice && { userLimit: input.userLimit }),
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
    const found = findChannel(this.deps.guild, channelInput);
    if (!found.ok) return rejected(found.reason);
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
        await this.deps.guild.channels.delete(channel.id);
        return t.deleted(channel.name);
      },
    });
  }
}
