import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  digestSchema,
  digestSystemPrompt,
  digestUserMessage,
  type DigestClass,
  type NewsDigest,
} from '../core/news-digest.js';
import type { NewsPost } from '../core/news.js';

export interface NewsSummarizer {
  /** Throws when Claude can't give a usable answer; the caller retries on the next poll. */
  digest(note: NewsPost): Promise<NewsDigest>;
}

/** Summaries by Claude (Haiku by default): one structured answer per announcement. */
export function createNewsSummarizer(deps: {
  client: Anthropic;
  model: () => string;
  classes: () => DigestClass[];
}): NewsSummarizer {
  return {
    async digest(note) {
      const classes = deps.classes();
      const response = await deps.client.messages.parse({
        model: deps.model(),
        max_tokens: 8000,
        // A summary is routine work; low effort keeps it quick and cheap.
        output_config: { effort: 'low', format: zodOutputFormat(digestSchema(classes)) },
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
