import { describe, expect, it } from 'vitest';
import { bbcodeToMarkdown, newsExcerpt, newsKind, parseNews, summarizeNews } from './news.js';

describe('bbcodeToMarkdown', () => {
  it('turns Steam headings, lists and bold into markdown and keeps escaped brackets', () => {
    const body =
      '[p][b]Olá Daevas,[/b][/p][h3][b]\\[Conteúdo][/b][/h3][p]\u200b[/p][p][b]Expedição[/b][/p]' +
      '[list][*][p]Modo Difícil.[/p][list][*][p]Nível 2.600.[/p][/*][/list][/*][/list]' +
      '[p]A opção \\[Controle] aparece.[/p][img]x.png[/img][url="https://x.y"]site[/url]';
    expect(bbcodeToMarkdown(body)).toBe(
      [
        '**Olá Daevas,**',
        '',
        '**[Conteúdo]**',
        '',
        '**Expedição**',
        '• Modo Difícil.',
        '  ◦ Nível 2.600.',
        '',
        'A opção [Controle] aparece.',
        '[site](https://x.y)',
      ].join('\n'),
    );
  });
});

describe('summarizeNews', () => {
  it('keeps the name, date, opening line and the bold topics of each section', () => {
    const summary = summarizeNews({
      title: '[Aviso] Notas da Atualização | 20 outubro (PDT) / 21 outubro (CEST)',
      body: [
        '**Olá Daevas,**',
        'Confira a atualização desta semana.',
        '',
        '**[Conteúdo & Sistemas]**',
        '**Expedição**',
        '• Modo Difícil.',
        '**Nome da Habilidade**',
        '**Mudanças de Classe**',
        '**[Evento]**',
        '**1. Enfrente o Desafio**',
        '**■ Detalhes do Item do Evento**',
        '**[Outras Melhorias e Correções de Bugs]**',
      ].join('\n'),
    });
    expect(summary).toEqual({
      name: 'Notas da Atualização',
      when: '20 outubro (PDT) / 21 outubro (CEST)',
      intro: 'Confira a atualização desta semana.',
      sections: [
        { title: 'Conteúdo & Sistemas', highlights: ['Expedição', 'Mudanças de Classe'] },
        { title: 'Evento', highlights: ['Enfrente o Desafio'] },
        { title: 'Outras Melhorias e Correções de Bugs', highlights: [] },
      ],
    });
  });

  it('copes with a plain title and no sections', () => {
    expect(summarizeNews({ title: 'Patch Notes', body: '' })).toEqual({
      name: 'Patch Notes',
      when: null,
      intro: null,
      sections: [],
    });
  });
});

describe('parseNews', () => {
  const event = (gid: string, name: string, posttime: number) => ({
    gid,
    event_name: name,
    clan_steamid: '103582791475596239',
    jsondata: JSON.stringify({
      localized_capsule_image: ['en.png', ...Array(21).fill(null), 'br.png'],
    }),
    announcement_body: { posttime, body: '[p]Texto[/p]' },
  });

  it('keeps every announcement, oldest first, with the Steam link and the Portuguese banner', () => {
    const notes = parseNews(
      {
        events: [
          event('2', '[Aviso] Notas da Atualização | 21 outubro', 200),
          event('3', '[Evento] Halloween', 300),
          event('1', '[Notice] Patch Notes | Oct. 13', 100),
        ],
      },
      3393110,
    );
    expect(notes.map((n) => n.id)).toEqual(['1', '2', '3']);
    expect(notes[1]).toMatchObject({
      url: 'https://store.steampowered.com/news/app/3393110/view/2',
      imageUrl: 'https://clan.akamai.steamstatic.com/images/46074831/br.png',
      body: 'Texto',
    });
    expect(parseNews({ nope: 1 }, 1)).toEqual([]);
  });
});

describe('newsKind', () => {
  it('tells the kind of a post from its title', () => {
    expect(newsKind('[Aviso] Notas da Atualização | 20 outubro')).toBe('patch');
    expect(newsKind('[Aviso] Manutenção temporária (EU)')).toBe('maintenance');
    expect(newsKind('Restrições de Conta | 23 outubro')).toBe('restriction');
    expect(newsKind('[Evento] Enfrente o Desafio')).toBe('event');
    expect(newsKind('Ludra desperta em 4 de novembro')).toBe('notice');
  });
});

describe('newsExcerpt', () => {
  it('drops the greeting and keeps whole paragraphs that fit', () => {
    const body = 'Olá, Daevas,\n\nPrimeiro parágrafo.\n\nSegundo parágrafo.\n\nTerceiro.';
    expect(newsExcerpt(body, 40)).toBe('Primeiro parágrafo.\n\nSegundo parágrafo.\n…');
    expect(newsExcerpt(body, 500)).toBe('Primeiro parágrafo.\n\nSegundo parágrafo.\n\nTerceiro.');
  });

  it('cuts a single long paragraph at a space', () => {
    expect(newsExcerpt('uma frase bem comprida demais', 14)).toBe('uma frase\n…');
  });
});
