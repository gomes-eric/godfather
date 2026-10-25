import { describe, expect, it } from 'vitest';
import type { ConfigStore } from '../config/store.js';
import { openDatabase } from '../db/client.js';
import { PatchNoteStore } from '../db/patch-notes.js';
import type { GuildDirectory } from '../discord/directory.js';
import type { Logger } from '../logger.js';
import { PatchNotesService } from './patch-notes.service.js';

const config = {
  get: () => ({
    settings: {
      patchNotes: {
        channel: 'patch-notes',
        steamAppId: 3393110,
        titleMatches: ['Notas'],
        pollMinutes: 15,
      },
    },
  }),
} as unknown as ConfigStore;
const logger = { info: () => undefined, warn: () => undefined } as unknown as Logger;

const event = (gid: string, posttime: number) => ({
  gid,
  event_name: `Notas da Atualização ${gid}`,
  announcement_body: { posttime, body: '[p]Texto[/p]' },
});

function setup(events: unknown[]) {
  const db = openDatabase(':memory:');
  const sent: string[] = [];
  const channel = {
    send: async (message: { embeds: { toJSON(): { title?: string } }[] }) => {
      sent.push(message.embeds[0]!.toJSON().title ?? '');
      return { id: String(sent.length) };
    },
  };
  const directory = { channelByKey: () => channel } as unknown as GuildDirectory;
  const feed = { events };
  const service = new PatchNotesService({
    config,
    directory,
    logger,
    store: new PatchNoteStore(db.db),
    fetchJson: async () => feed,
  });
  return { service, sent, feed };
}

describe('PatchNotesService', () => {
  it('posts only the latest notes on the first run, then each new one once', async () => {
    const { service, sent, feed } = setup([event('a', 1), event('b', 2)]);

    expect(await service.poll()).toBe(1);
    expect(sent).toEqual(['📜 Notas da Atualização b']);

    expect(await service.poll()).toBe(0);

    feed.events.push(event('c', 3));
    expect(await service.poll()).toBe(1);
    expect(sent).toEqual(['📜 Notas da Atualização b', '📜 Notas da Atualização c']);
  });
});
