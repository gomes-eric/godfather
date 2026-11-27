import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  digestSchema,
  digestSystemPrompt,
  digestUserMessage,
  type DigestClass,
  type NewsDigest,
} from '../core/news-digest.js';
import type { NewsPost } from '../core/news.js';

export interface DigestOptions {
  model: string;
  classes: readonly DigestClass[];
}

export interface NewsSummarizer {
  digest(note: NewsPost, options: DigestOptions): Promise<NewsDigest>;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const hasServerFallback = (model: string) => !model.startsWith('claude-haiku');

export function createNewsSummarizer(client: Anthropic): NewsSummarizer {
  return {
    async digest(note, { model, classes }) {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 8000,
        output_config: { effort: 'low', format: betaZodOutputFormat(digestSchema(classes)) },
        ...(hasServerFallback(model) && { betas: [FALLBACK_BETA], fallbacks: 'default' as const }),
        system: [
          {
            type: 'text',
            text: digestSystemPrompt(classes),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: digestUserMessage(note) }],
      });
      if (response.stop_reason === 'refusal') {
        throw new Error(`Claude declined to summarize (${response.stop_details?.category})`);
      }
      if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
        throw new Error(`Claude gave no usable summary (stop: ${response.stop_reason})`);
      }
      return response.parsed_output;
    },
  };
}
