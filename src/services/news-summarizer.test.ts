import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { NewsDigest } from '../core/news-digest.js';
import { createNewsSummarizer } from './news-summarizer.js';

const note = {
  id: '1',
  title: 'Notas da Atualização',
  body: 'Mago: Tempestade Gélida corrigida.',
  postedAt: new Date('2026-10-28T08:00:00Z'),
  url: 'https://store.steampowered.com/news/app/3393110/view/1',
  imageUrl: null,
};
const classes = [{ key: 'class-sorcerer', name: 'Mago', gameName: 'Sorcerer' }];
const digest: NewsDigest = {
  publish: true,
  skipReason: '',
  kind: 'patch',
  title: 'Notas da atualização',
  when: '',
  summary: 'Correções.',
  sections: [],
  triniel: false,
  classes: [],
};

function fakeClient(response: object) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (request: Record<string, unknown>) => {
          requests.push(request);
          return response;
        },
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

const answered = { stop_reason: 'end_turn', stop_details: null, parsed_output: digest };

describe('createNewsSummarizer', () => {
  it('asks the given model with the class list in the cached prompt and returns the digest', async () => {
    const { client, requests } = fakeClient(answered);
    const summarizer = createNewsSummarizer(client);

    expect(await summarizer.digest(note, { model: 'claude-sonnet-5-5', classes })).toEqual(digest);
    const [request] = requests;
    expect(request).toMatchObject({
      model: 'claude-sonnet-5-5',
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: expect.stringContaining(note.body) }],
    });
    const [system] = request!.system as { text: string; cache_control: unknown }[];
    expect(system!.text).toContain('- Sorcerer → Mago (chave `class-sorcerer`)');
    expect(system!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('asks a Haiku model without the server-side fallback, which Haiku does not have', async () => {
    const { client, requests } = fakeClient(answered);
    await createNewsSummarizer(client).digest(note, { model: 'claude-haiku-5-5', classes });
    expect(requests[0]).not.toHaveProperty('betas');
    expect(requests[0]).not.toHaveProperty('fallbacks');
  });

  it.each([
    [
      'a refusal, with its category',
      { stop_reason: 'refusal', stop_details: { category: 'cyber' }, parsed_output: null },
      'Claude declined to summarize (cyber)',
    ],
    [
      'an answer cut at max_tokens',
      { stop_reason: 'max_tokens', stop_details: null, parsed_output: digest },
      'Claude gave no usable summary (stop: max_tokens)',
    ],
    [
      'an answer without the digest',
      { stop_reason: 'end_turn', stop_details: null, parsed_output: null },
      'Claude gave no usable summary (stop: end_turn)',
    ],
  ])('fails on %s, so the post waits for a retry', async (_, response, message) => {
    const { client } = fakeClient(response);
    await expect(
      createNewsSummarizer(client).digest(note, { model: 'claude-sonnet-5-5', classes }),
    ).rejects.toThrow(message);
  });
});
