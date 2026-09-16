/**
 * Local model provider — Ollama, vLLM, LM Studio, or any OpenAI-compatible
 * local server. Cost is zero per token; the cost guard always prefers it when
 * the tier allows.
 *
 * Configure: LOCAL_ENABLED=true, LOCAL_MODEL=<model name>, LOCAL_BASE_URL=<url>
 * Default base URL is http://localhost:11434/v1 (Ollama).
 */
import { env } from '../config/env.js';
import { BaseProvider, ProviderError } from './base.provider.js';
import type { NormalizedRequest, NormalizedResponse, ProviderName } from '../core/types.js';

interface ChatCompletion {
  choices: Array<{ message: { content: string | null }; finish_reason: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export class LocalProvider extends BaseProvider {
  readonly name: ProviderName = 'local';

  constructor(private readonly baseUrl = env.LOCAL_BASE_URL) {
    super();
  }

  protected async send(req: NormalizedRequest): Promise<NormalizedResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: req.prompt });

    const data = await this.post<ChatCompletion>(
      `${this.baseUrl}/chat/completions`,
      {}, // No auth for local servers
      {
        model: req.modelId,
        messages,
        max_tokens: req.maxOutputTokens,
        temperature: req.temperature,
      },
      req.signal,
    );

    const choice = data.choices[0];
    if (!choice) throw new ProviderError('empty choices array', 502, true, this.name);

    const prompt_tokens = data.usage?.prompt_tokens ?? estimateTokens(req.prompt);
    const completion_tokens = data.usage?.completion_tokens ?? estimateTokens(choice.message.content ?? '');

    return {
      output: choice.message.content ?? '',
      inputTokens: prompt_tokens,
      outputTokens: completion_tokens,
      finishReason: mapFinishReason(choice.finish_reason),
    };
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.7);
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
