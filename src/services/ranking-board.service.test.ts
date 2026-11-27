import { describe, expect, it } from 'vitest';
import { CharacterStore } from '../db/characters.js';
import { openDatabase } from '../db/client.js';
import { ManagedObjectStore } from '../db/managed-objects.js';
import { RankingBoard } from './ranking-board.service.js';
import { fakeDirectory, testConfig } from './testing/roster-fixture.js';

describe('RankingBoard', () => {
  it('lists the legion members still in the server by combat power', async () => {
    const config = testConfig();
    const db = openDatabase(':memory:');
    const registrations = new CharacterStore(db.db);
    const save = (userId: string, name: string, legion: string, combatPower: number) =>
      registrations.save({
        userId,
        characterId: `c-${userId}`,
        serverId: 2403,
        name,
        classKey: 'class-cleric',
        legion,
        combatPower,
        itemLevel: 2100,
      });
    save('u1', 'Padrinho', 'M4F1A', 150);
    save('u2', 'Padrinho Jr', 'M4F1A', 300);
    save('u3', 'Padrinho Aliado', 'Noxus', 999);
    save('gone', 'Padrinho Sumido', 'M4F1A', 500);

    const posted: string[] = [];
    const directory = fakeDirectory(() => config.get());
    directory.channelByKey = () =>
      ({
        send: async (message: { embeds: { toJSON(): { description?: string } }[] }) => {
          posted.push(message.embeds[0]!.toJSON().description ?? '');
          return { id: 'ranking-msg' };
        },
        messages: { fetch: async () => null },
      }) as never;
    const guild = {
      members: {
        fetch: async ({ user }: { user: string[] }) =>
          new Map(user.filter((id) => id !== 'gone').map((id) => [id, {}])),
      },
    };
    const board = new RankingBoard({
      guild: guild as never,
      config,
      directory,
      managed: new ManagedObjectStore(db.db),
      registrations,
    });

    await board.refresh();
    expect(posted[0]).toContain('🥇 ✨ **Padrinho Jr** · ⚔️ 300 · 🎚️ 2.100');
    expect(posted[0]).toContain('🥈 ✨ **Padrinho** · ⚔️ 150');
    expect(posted[0]).not.toContain('Padrinho Aliado');
    expect(posted[0]).not.toContain('Padrinho Sumido');
  });
});
