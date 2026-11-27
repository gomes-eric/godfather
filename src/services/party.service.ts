import { rejected, type ActionRunner, type ServiceOutcome } from '../core/action.js';
import type { Actor } from '../core/actor.js';
import type { Party, PartyStore } from '../db/parties.js';
import { ptBR } from '../i18n/pt-BR.js';

const t = ptBR.party;

export type PartyAction = 'join' | 'leave' | 'close';

export interface PartyView {
  id: number;
  activity: string;
  startsAt: string | null;
  ownerId: string;
  slots: number;
  closed: boolean;
  members: { id: string; emoji: string }[];
}

export interface PartyUpdate {
  view: PartyView;
  filled?: { text: string; mentionIds: string[] };
}

export class PartyService {
  constructor(
    private readonly deps: {
      store: PartyStore;
      runAction: ActionRunner;
      classEmoji: (userId: string) => string | undefined;
    },
  ) {}

  create(
    actor: Actor,
    input: { channelId: string; activity: string; slots: number; startsAt: string | null },
  ): Promise<ServiceOutcome<PartyView>> {
    return this.deps.runAction({
      actor,
      action: 'party.create',
      target: input.activity,
      params: input,
      preview: input.activity,
      execute: async () => this.view(this.deps.store.create({ ...input, ownerId: actor.userId })),
    });
  }

  async act(
    actor: Actor,
    partyId: number,
    action: PartyAction,
  ): Promise<ServiceOutcome<PartyUpdate>> {
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
    }

    return this.deps.runAction({
      actor,
      action: action === 'close' && !isOwner ? 'party.close.any' : (`party.${action}` as const),
      target: party.activity,
      params: { partyId, action },
      preview: party.activity,
      execute: async (): Promise<PartyUpdate> => {
        if (action === 'join') store.join(party.id, actor.userId);
        if (action === 'leave') store.leave(party.id, actor.userId);
        if (action === 'close') store.close(party.id);
        const view = this.view(store.get(party.id)!);
        const ids = view.members.map((m) => m.id);
        if (action !== 'join' || ids.length < view.slots) return { view };
        return { view, filled: { text: t.filled(view.activity, ids), mentionIds: ids } };
      },
    });
  }

  private view(party: Party): PartyView {
    return {
      id: party.id,
      activity: party.activity,
      startsAt: party.startsAt,
      ownerId: party.ownerId,
      slots: party.slots,
      closed: party.closed,
      members: this.deps.store
        .members(party.id)
        .map((id) => ({ id, emoji: this.deps.classEmoji(id) ?? '🎮' })),
    };
  }
}
