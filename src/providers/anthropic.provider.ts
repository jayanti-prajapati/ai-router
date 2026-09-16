/**
 * Anthropic provider (Messages API).
 * Docs: https://docs.claude.com/en/api/messages
 *
 * Note the shape differences from OpenAI that this class absorbs:
 *   - the system prompt is a top-level field, not a message
 *   - max_tokens is required
 *   - content comes back as an array of blocks
 *   - usage keys are input_tokens / output_tokens
 */
import { env } from '../config/env.js';
import { BaseProvider, ProviderError } from './base.provider.js';
import type { NormalizedRequest, NormalizedResponse, ProviderName } from '../core/types.js';

interface MessageResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export class AnthropicProvider extends BaseProvider {
  readonly name: ProviderName = 'anthropic';

  constructor(
    private readonly apiKey = env.ANTHROPIC_API_KEY!,
    private readonly baseUrl = env.ANTHROPIC_BASE_URL,
  ) {
    super();
  }

  protected async send(req: NormalizedRequest): Promise<NormalizedResponse> {
    const data = await this.post<MessageResponse>(
      `${this.baseUrl}/messages`,
      {
        'x-api-key': this.apiKey,
        'anthropic-version': env.ANTHROPIC_VERSION,
      },
      {
        model: req.modelId,
        max_tokens: req.maxOutputTokens,
        temperature: req.temperature,
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: 'user', content: req.prompt }],
      },
      req.signal,
    );

    // Concatenate text blocks; tool_use / thinking blocks are ignored here.
    const output = data.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n');

    if (!output && data.content.length === 0) {
      throw new ProviderError('empty content array', 502, true, this.name);
    }

    return {
      output,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      finishReason: mapStopReason(data.stop_reason),
    };
  }
}

function mapStopReason(reason: string | null): NormalizedResponse['finishReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
    case 'tool_use':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'refusal':
      return 'content_filter';
    default:
      return 'unknown';
  }
}
