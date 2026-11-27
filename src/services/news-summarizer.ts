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

export interface NewsSummarizer {
  digest(note: NewsPost): Promise<NewsDigest>;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const hasServerFallback = (model: string) => !model.startsWith('claude-haiku');

export function createNewsSummarizer(deps: {
  client: Anthropic;
  model: () => string;
  classes: () => DigestClass[];
}): NewsSummarizer {
  return {
    async digest(note) {
      const classes = deps.classes();
      const model = deps.model();
      const response = await deps.client.beta.messages.parse({
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
