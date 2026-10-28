import { describe, expect, it } from 'vitest';
import { digestDescription, newsMessage } from './news.js';

const note = {
  id: '1',
  title: '[Aviso] Notas da Atualização | 20 outubro (PDT) / 21 outubro (CEST)',
  postedAt: new Date('2026-10-21T06:30:00Z'),
  url: 'https://store.steampowered.com/news/app/3393110/view/1',
  imageUrl: 'https://clan.akamai.steamstatic.com/images/1/br.png',
  body: [
    '**Olá Daevas,**',
    'Confira a atualização desta semana.',
    '**[Conteúdo & Sistemas]**',
    '**Expedição**',
    '• O modo Difícil será adicionado.',
    '**[Outras Melhorias e Correções de Bugs]**',
  ].join('\n'),
};

describe('newsMessage', () => {
  it('is one card with name, date, intro, highlights, banner and a Steam button', () => {
    const { embeds, components } = newsMessage(note);
    const embed = embeds[0]!.toJSON();

    expect(embed.title).toBe('📜 Notas da Atualização');
    expect(embed.url).toBe(note.url);
    expect(embed.image?.url).toBe(note.imageUrl);
    expect(embed.description).toBe(
      '🗓️ 20 outubro (PDT) / 21 outubro (CEST)\n\nConfira a atualização desta semana.',
    );
    expect(embed.fields).toEqual([
      { name: '🧭 Conteúdo & Sistemas', value: '• Expedição' },
      { name: '🔧 Outras Melhorias e Correções de Bugs', value: 'Detalhes na Steam.' },
    ]);
    const button = components[0]!.toJSON().components[0]!;
    expect(button).toMatchObject({ url: note.url, label: 'Ler na Steam' });
  });

  it('shows the opening paragraphs of a post without sections, styled by its kind', () => {
    const { embeds } = newsMessage({
      ...note,
      title: '[Aviso] Manutenção | 27 outubro (PDT) / 28 outubro (CET)',
      body: 'Olá, Daevas,\n\nRealizaremos a manutenção programada.\n\n**__Detalhes:__**\nDuração: 4h30',
    });
    const embed = embeds[0]!.toJSON();

    expect(embed.title).toBe('🛠️ Manutenção');
    expect(embed.author?.name).toBe('AION 2 · Manutenção');
    expect(embed.description).toBe(
      [
        '🗓️ 27 outubro (PDT) / 28 outubro (CET)',
        'Realizaremos a manutenção programada.',
        '**__Detalhes:__**\nDuração: 4h30',
      ].join('\n\n'),
    );
    expect(embed.fields ?? []).toEqual([]);
  });
});

describe('digestDescription', () => {
  it('puts each section under a heading as a Markdown list, at most 4 by 4', () => {
    const points = ['um', 'dois', 'três', 'quatro', 'cinco'];
    const text = digestDescription({
      when: '28/10 04:30 (Brasília)',
      summary: 'Resumo.',
      sections: [
        { emoji: '🐉', title: 'Expedição', points },
        { emoji: '🛡️', title: 'Classes', points: [] },
        { emoji: 'a', title: 'A', points: ['x'] },
        { emoji: 'b', title: 'B', points: ['x'] },
        { emoji: 'c', title: 'C', points: ['x'] },
      ],
    });
    expect(text).toBe(
      [
        '🗓️ 28/10 04:30 (Brasília)',
        '',
        'Resumo.',
        '',
        '### 🐉 Expedição',
        '- um',
        '- dois',
        '- três',
        '- quatro',
        '',
        '### a A',
        '- x',
        '',
        '### b B',
        '- x',
      ].join('\n'),
    );
  });

  it('leaves out whole sections that would pass the embed limit', () => {
    const long = 'x'.repeat(1000);
    const text = digestDescription({
      when: '',
      summary: 'Resumo.',
      sections: [1, 2, 3, 4].map((n) => ({ emoji: '📌', title: `S${n}`, points: [long, long] })),
    });
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toContain('### 📌 S1');
    expect(text).not.toContain('### 📌 S3');
  });
});
