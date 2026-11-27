import { describe, expect, it } from 'vitest';
import type { ConfigStore } from '../config/store.js';
import { openDatabase } from '../db/client.js';
import { NewsStore } from '../db/news.js';
import type { NewsMessage } from '../discord/news.js';
import type { Logger } from '../logger.js';
import type { NewsDigest } from '../core/news-digest.js';
import type { NewsPost } from '../core/news.js';
import type { DigestOptions } from './news-summarizer.js';
import { NewsService, type NewsPort } from './news.service.js';

const news = { channel: 'news', steamAppId: 3393110, pollMinutes: 15 };
const config = { get: () => ({ settings: { news } }) } as unknown as ConfigStore;
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
const SORCERER_ROLE = '900000000000000001';

interface Posted {
  channel: string;
  title: string;
  content: string;
  allowedMentions: unknown;
}

function fakePort(channels = ['news', 'officers']) {
  const sent: Posted[] = [];
  const port: NewsPort = {
    channel: (key) =>
      channels.includes(key)
        ? {
            post: async (message: NewsMessage) => {
              sent.push({
                channel: key,
                title: message.embeds[0]!.toJSON().title ?? '',
                content: message.content ?? '',
                allowedMentions: message.allowedMentions,
              });
              return String(sent.length);
            },
          }
        : undefined,
    roleId: (key) => (key === 'class-sorcerer' ? SORCERER_ROLE : undefined),
  };
  return { port, sent };
}

function setup(events: unknown[]) {
  const db = openDatabase(':memory:');
  const { port, sent } = fakePort();
  const feed = { events };
  const clock = { now: new Date(0) };
  const service = new NewsService({
    config,
    port,
    logger,
    store: new NewsStore(db.db),
    fetchJson: async () => feed,
    now: () => clock.now,
  });
  return { service, sent: () => sent.map((m) => m.title), feed, clock };
}

describe('NewsService', () => {
  it('posts only the latest notes on the first run, then each new one once', async () => {
    const { service, sent, feed } = setup([event('a', 1), event('b', 2)]);

    expect(await service.poll()).toBe(1);
    expect(sent()).toEqual(['📜 Notas da Atualização b']);

    expect(await service.poll()).toBe(0);

    feed.events.push(event('c', 3));
    expect(await service.poll()).toBe(1);
    expect(sent()).toEqual(['📜 Notas da Atualização b', '📜 Notas da Atualização c']);
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
    expect(sent().slice(1)).toEqual([
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
    expect(sent().at(-1)).toBe("📰 Avis d'un nouvel événement");
  });

  it('answers that summaries are off when server.yaml has no summary', async () => {
    const { service } = setup([event('a', 1)]);
    expect(await service.preview(3, 'officers')).toEqual([
      expect.stringContaining('Os resumos estão desligados'),
    ]);
  });
});

const CLASS_NAMES: Record<string, string> = {
  'class-gladiator': 'Gladiador',
  'class-templar': 'Templário',
  'class-assassin': 'Assassino',
  'class-ranger': 'Arqueiro',
  'class-sorcerer': 'Mago',
  'class-spiritmaster': 'Espiritualista',
  'class-cleric': 'Clérigo',
  'class-chanter': 'Encantador',
};

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
    const { port, sent } = fakePort();
    const feed = { events: [event('a', 1)] };
    const asked: { title: string; options: DigestOptions }[] = [];
    const clock = { now: new Date(0) };
    const summaryConfig = {
      get: () => ({
        settings: { news: { ...news, summary: { model: 'claude-sonnet-5-5' } } },
        roles: [
          { key: 'visitor', name: 'Visitante' },
          ...Object.entries(CLASS_NAMES).map(([key, name]) => ({ key, name, class: true })),
        ],
      }),
    } as unknown as ConfigStore;
    const service = new NewsService({
      config: summaryConfig,
      port,
      logger,
      store: new NewsStore(db.db),
      summarizer: {
        digest: async (note, options) => {
          asked.push({ title: note.title, options });
          return answer(note);
        },
      },
      fetchJson: async () => feed,
      now: () => clock.now,
    });
    return { service, sent, feed, read: () => asked.map((a) => a.title), asked, clock };
  }

  it('gives Claude the post in whatever language it came and posts the summary card', async () => {
    const s = setupSummaries(async () => digest());
    s.feed.events[0] = event('a', 1, '[Avis] Notes de mise à jour', FRENCH);
    expect(await s.service.poll()).toBe(1);
    expect(s.read()).toEqual(['[Avis] Notes de mise à jour']);
    expect(s.sent).toEqual([
      {
        channel: 'news',
        title: '📜 Notas da atualização',
        content: '',
        allowedMentions: { parse: [], roles: [] },
      },
    ]);
  });

  it("asks with server.yaml's model and the legion's classes, by their game names", async () => {
    const s = setupSummaries(async () => digest());
    await s.service.poll();
    const { model, classes } = s.asked[0]!.options;
    expect(model).toBe('claude-sonnet-5-5');
    expect(classes).toHaveLength(8);
    expect(classes).toContainEqual({ key: 'class-sorcerer', name: 'Mago', gameName: 'Sorcerer' });
  });

  it('pings everyone for Triniel and the roles the server has for the changed classes', async () => {
    const s = setupSummaries(async () =>
      digest({
        triniel: true,
        classes: ['class-sorcerer', 'class-cleric'],
        sections: [{ emoji: '⚔️', title: 'Classes', points: ['Mago: a', 'Clérigo: b'] }],
      }),
    );
    s.feed.events[0] = event(
      'a',
      1,
      'Pareamento de Servidor',
      '[p]América do Sul: Triniel x Marchutan[/p]',
    );
    await s.service.poll();
    expect(s.sent[0]).toMatchObject({
      content: `@everyone <@&${SORCERER_ROLE}> · afeta o Triniel · mudanças na sua classe`,
      allowedMentions: { parse: ['everyone'], roles: [SORCERER_ROLE] },
    });
  });

  it('marks posts Claude leaves out as seen without posting them', async () => {
    const s = setupSummaries(async () => digest({ publish: false, skipReason: 'banimentos' }));
    expect(await s.service.poll()).toBe(0);
    expect(await s.service.poll()).toBe(0);
    expect(s.read()).toHaveLength(1);
    expect(s.sent).toEqual([]);
  });

  it('retries a failed summary, then posts the plain card after 12h', async () => {
    const s = setupSummaries(async () => {
      throw new Error('API down');
    });
    s.clock.now = new Date(2 * HOUR * 1000);
    expect(await s.service.poll()).toBe(0);
    expect(await s.service.poll()).toBe(0);
    expect(s.read()).toHaveLength(2);

    s.clock.now = new Date(13 * HOUR * 1000);
    expect(await s.service.poll()).toBe(1);
    expect(s.sent).toMatchObject([
      { title: '📜 Notas da Atualização a', allowedMentions: { parse: [] } },
    ]);
  });

  describe('preview', () => {
    it('posts the latest summaries to the given channel, naming whom they would ping', async () => {
      const s = setupSummaries(async (note) =>
        note.title === 'Pareamento'
          ? digest({ triniel: true, classes: ['class-sorcerer'] })
          : digest({ publish: false, skipReason: 'só cosméticos' }),
      );
      s.feed.events = [
        event('a', 1, 'Antigo'),
        event('b', 2, 'Pareamento', '[p]Triniel[/p]'),
        event('c', 3, 'Visuais'),
      ];

      expect(await s.service.preview(2, 'officers')).toEqual([
        '✅ Pareamento: prévia postada',
        '⏭️ Visuais: ficaria de fora (só cosméticos)',
      ]);
      expect(s.read()).toEqual(['Pareamento', 'Visuais']);
      expect(s.sent).toEqual([
        {
          channel: 'officers',
          title: '📜 Notas da atualização',
          content: '🔍 Prévia do resumo · marcaria: @everyone, Mago',
          allowedMentions: { parse: [] },
        },
      ]);
    });

    it('names no ping when the card would ping no one', async () => {
      const s = setupSummaries(async () => digest());
      await s.service.preview(1, 'officers');
      expect(s.sent[0]?.content).toBe('🔍 Prévia do resumo');
    });

    it('says when the channel does not exist, without asking Claude', async () => {
      const s = setupSummaries(async () => digest());
      expect(await s.service.preview(1, 'nope')).toEqual(['Não achei o canal `nope`.']);
      expect(s.read()).toEqual([]);
    });
  });
});
