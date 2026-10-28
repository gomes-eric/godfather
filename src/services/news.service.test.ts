import { describe, expect, it } from 'vitest';
import type { ConfigStore } from '../config/store.js';
import { openDatabase } from '../db/client.js';
import { NewsStore } from '../db/news.js';
import type { GuildDirectory } from '../discord/directory.js';
import type { Logger } from '../logger.js';
import { NewsService } from './news.service.js';

const config = {
  get: () => ({
    settings: {
      news: {
        channel: 'news',
        steamAppId: 3393110,
        pollMinutes: 15,
      },
    },
  }),
} as unknown as ConfigStore;
const logger = { info: () => undefined, warn: () => undefined } as unknown as Logger;

const event = (gid: string, posttime: number, name = `Notas da Atualização ${gid}`) => ({
  gid,
  event_name: name,
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
  const service = new NewsService({
    config,
    directory,
    logger,
    store: new NewsStore(db.db),
    fetchJson: async () => feed,
  });
  return { service, sent, feed };
}

describe('NewsService', () => {
  it('posts only the latest notes on the first run, then each new one once', async () => {
    const { service, sent, feed } = setup([event('a', 1), event('b', 2)]);

    expect(await service.poll()).toBe(1);
    expect(sent).toEqual(['📜 Notas da Atualização b']);

    expect(await service.poll()).toBe(0);

    feed.events.push(event('c', 3));
    expect(await service.poll()).toBe(1);
    expect(sent).toEqual(['📜 Notas da Atualização b', '📜 Notas da Atualização c']);
  });

  it('posts every kind of announcement, oldest first', async () => {
    const { service, sent, feed } = setup([event('a', 1)]);
    await service.poll();

    feed.events.push(
      event('m', 3, '[Aviso] Manutenção | 27 outubro (PDT)'),
      event('e', 2, '[Evento] Enfrente o Desafio'),
      event('l', 4, 'Ludra desperta em 4 de novembro'),
    );
    expect(await service.poll()).toBe(3);
    expect(sent.slice(1)).toEqual([
      '🎉 Enfrente o Desafio',
      '🛠️ Manutenção',
      '📰 Ludra desperta em 4 de novembro',
    ]);
  });
});
