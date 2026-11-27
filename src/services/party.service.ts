import type { Guild } from 'discord.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import { tierAtLeast } from '../core/tiers.js';
import type { Party, PartyStore } from '../db/parties.js';
import type { GuildDirectory } from '../discord/directory.js';
import { partyCard, type PartyView } from '../discord/party-card.js';
import { ptBR } from '../i18n/pt-BR.js';

const t = ptBR.party;

export type PartyAction = 'join' | 'leave' | 'close';

export class PartyService {
  constructor(
    private readonly deps: {
      guild: Guild;
      directory: GuildDirectory;
      store: PartyStore;
      runAction: ActionRunner;
    },
  ) {}

  private classEmoji(userId: string): string {
    const member = this.deps.guild.members.cache.get(userId);
    return (member && this.deps.directory.classesOf(member)[0]?.emoji) ?? '🎮';
  }

  view(party: Party): PartyView {
    return {
      id: party.id,
      activity: party.activity,
      startsAt: party.startsAt,
      ownerId: party.ownerId,
      slots: party.slots,
      closed: party.closed,
      members: this.deps.store.members(party.id).map((id) => ({ id, emoji: this.classEmoji(id) })),
    };
  }

  create(
    actor: Actor,
    input: { channelId: string; activity: string; slots: number; startsAt: string | null },
  ): Promise<ServiceOutcome<Party>> {
    return this.deps.runAction({
      actor,
      action: 'party.create',
      target: input.activity,
      params: input,
      preview: input.activity,
      execute: async () => this.deps.store.create({ ...input, ownerId: actor.userId }),
    });
  }

  card(party: Party) {
    return partyCard(this.view(party));
  }

  async act(
    actor: Actor,
    partyId: number,
    action: PartyAction,
  ): Promise<ServiceOutcome<{ party: Party; justFilled: boolean }>> {
    const { store } = this.deps;
    const party = store.get(partyId);
    if (!party) return rejected(t.gone);
    if (party.closed) return rejected(t.alreadyClosed);
    const members = store.members(party.id);
    const isMember = members.includes(actor.userId);
    const isOwner = party.ownerId === actor.userId;

    if (action === 'join') {
      if (isMember) return rejected(t.alreadyIn);
      if (members.length >= party.slots) return rejected(t.full);
    } else if (action === 'leave') {
      if (!isMember) return rejected(t.notIn);
      if (isOwner) return rejected(t.ownerCantLeave);
    } else if (!isOwner && !tierAtLeast(actor.tier, 'officer')) {
      return rejected(t.onlyOwnerCloses);
    }

    return this.deps.runAction({
      actor,
      action: action === 'close' ? 'party.close' : 'party.join',
      target: party.activity,
      params: { partyId, action },
      preview: party.activity,
      execute: async () => {
        if (action === 'join') store.join(party.id, actor.userId);
        if (action === 'leave') store.leave(party.id, actor.userId);
        if (action === 'close') store.close(party.id);
        const updated = store.get(party.id)!;
        const justFilled = action === 'join' && store.members(party.id).length >= updated.slots;
        return { party: updated, justFilled };
      },
    });
  }
}
