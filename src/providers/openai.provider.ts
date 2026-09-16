/**
 * OpenAI provider (Chat Completions). Also used for any OpenAI-compatible
 * gateway — Azure OpenAI, OpenRouter, Together, Groq — by changing baseUrl.
 */
import { env } from '../config/env.js';
import { BaseProvider, ProviderError } from './base.provider.js';
import type { NormalizedRequest, NormalizedResponse, ProviderName } from '../core/types.js';

interface ChatCompletion {
  choices: Array<{ message: { content: string | null }; finish_reason: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export class OpenAIProvider extends BaseProvider {
  readonly name: ProviderName = 'openai';

  constructor(
    private readonly apiKey = env.OPENAI_API_KEY!,
    private readonly baseUrl = env.OPENAI_BASE_URL,
  ) {
    super();
  }

  protected async send(req: NormalizedRequest): Promise<NormalizedResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: req.prompt });

    const data = await this.post<ChatCompletion>(
      `${this.baseUrl}/chat/completions`,
      { authorization: `Bearer ${this.apiKey}` },
      {
        model: req.modelId,
        messages,
        max_completion_tokens: req.maxOutputTokens,
        temperature: req.temperature,
      },
      req.signal,
    );

    const choice = data.choices[0];
    if (!choice) throw new ProviderError('empty choices array', 502, true, this.name);

    return {
      output: choice.message.content ?? '',
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      finishReason: mapFinishReason(choice.finish_reason),
    };
  }
}

function mapFinishReason(reason: string): NormalizedResponse['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'unknown';
  }
}
