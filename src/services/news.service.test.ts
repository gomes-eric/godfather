import { describe, expect, it } from 'vitest';
import type { ConfigStore } from '../config/store.js';
import { openDatabase } from '../db/client.js';
import { NewsStore } from '../db/news.js';
import type { GuildDirectory } from '../discord/directory.js';
import type { Logger } from '../logger.js';
import type { NewsDigest } from '../core/news-digest.js';
import type { NewsPost } from '../core/news.js';
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

const event = (
  gid: string,
  posttime: number,
  name = `Notas da Atualização ${gid}`,
  body = '[p]Texto[/p]',
) => ({
  gid,
  event_name: name,
  announcement_body: { posttime, body },
});

const HOUR = 3600;
const FRENCH = '[p]Bonjour, chers Daevas ! Le nouvel événement commence pour vous et vos amis.[/p]';

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
  const clock = { now: new Date(0) };
  const service = new NewsService({
    config,
    directory,
    logger,
    store: new NewsStore(db.db),
    fetchJson: async () => feed,
    now: () => clock.now,
  });
  return { service, sent, feed, clock };
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

  it('posts a plain card as it came, whatever its language', async () => {
    const { service, sent, feed } = setup([event('a', 1)]);
    await service.poll();

    feed.events.push(event('f', HOUR, "[Avis] Avis d'un nouvel événement", FRENCH));
    expect(await service.poll()).toBe(1);
    expect(sent.at(-1)).toBe("📰 Avis d'un nouvel événement");
  });
});

describe('NewsService with Claude summaries', () => {
  const digest = (over: Partial<NewsDigest> = {}): NewsDigest => ({
    publish: true,
    skipReason: '',
    kind: 'patch',
    title: 'Notas da atualização',
    when: '28/10 04:30 (Brasília)',
    summary: 'Ludra chega com modo Difícil.',
    sections: [{ emoji: '⚔️', title: 'Classes', points: ['Mago: Tempestade Gélida corrigida'] }],
    triniel: false,
    classes: [],
    ...over,
  });

  function setupSummaries(answer: (note: NewsPost) => Promise<NewsDigest>) {
    const db = openDatabase(':memory:');
    const sent: { title: string; content: string; allowedMentions: unknown }[] = [];
    const channel = {
      send: async (message: {
        content?: string;
        allowedMentions?: unknown;
        embeds: { toJSON(): { title?: string } }[];
      }) => {
        sent.push({
          title: message.embeds[0]!.toJSON().title ?? '',
          content: message.content ?? '',
          allowedMentions: message.allowedMentions,
        });
        return { id: String(sent.length) };
      },
    };
    const directory = {
      channelByKey: () => channel,
      roleId: (key: string) => (key === 'class-sorcerer' ? '900000000000000001' : undefined),
    } as unknown as GuildDirectory;
    const feed = { events: [event('a', 1)] };
    const read: string[] = [];
    const clock = { now: new Date(0) };
    const summaryConfig = {
      get: () => ({
        settings: {
          news: { ...config.get().settings.news, summary: { model: 'claude-haiku-5-5' } },
        },
      }),
    } as unknown as ConfigStore;
    const service = new NewsService({
      config: summaryConfig,
      directory,
      logger,
      store: new NewsStore(db.db),
      summarizer: {
        digest: async (note) => {
          read.push(note.title);
          return answer(note);
        },
      },
      fetchJson: async () => feed,
      now: () => clock.now,
    });
    return { service, sent, feed, read, clock };
  }

  it('gives Claude the post in whatever language it came and posts the summary card', async () => {
    const s = setupSummaries(async () => digest());
    s.feed.events[0] = event('a', 1, '[Avis] Notes de mise à jour', FRENCH);
    expect(await s.service.poll()).toBe(1);
    expect(s.read).toEqual(['[Avis] Notes de mise à jour']);
    expect(s.sent).toEqual([
      { title: '📜 Notas da atualização', content: '', allowedMentions: { parse: [], roles: [] } },
    ]);
  });

  it('pings everyone for Triniel and the roles of changed classes', async () => {
    const s = setupSummaries(async () =>
      digest({ triniel: true, classes: ['class-sorcerer', 'class-unknown'] }),
    );
    await s.service.poll();
    expect(s.sent[0]).toMatchObject({
      content: '@everyone <@&900000000000000001> · afeta o Triniel · mudanças na sua classe',
      allowedMentions: { parse: ['everyone'], roles: ['900000000000000001'] },
    });
  });

  it('marks posts Claude leaves out as seen without posting them', async () => {
    const s = setupSummaries(async () => digest({ publish: false, skipReason: 'banimentos' }));
    expect(await s.service.poll()).toBe(0);
    expect(await s.service.poll()).toBe(0);
    expect(s.read).toHaveLength(1);
    expect(s.sent).toEqual([]);
  });

  it('retries a failed summary, then posts the plain card after 12h', async () => {
    const s = setupSummaries(async () => {
      throw new Error('API down');
    });
    s.clock.now = new Date(2 * HOUR * 1000);
    expect(await s.service.poll()).toBe(0);
    expect(await s.service.poll()).toBe(0);
    expect(s.read).toHaveLength(2);

    s.clock.now = new Date(13 * HOUR * 1000);
    expect(await s.service.poll()).toBe(1);
    expect(s.sent.map((m) => m.title)).toEqual(['📜 Notas da Atualização a']);
  });
});
