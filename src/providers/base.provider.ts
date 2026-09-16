/**
 * Abstract base provider with retry, exponential backoff, and full jitter.
 *
 * All concrete providers extend this and implement only `send()`. The base
 * handles the retry loop, error normalisation, and the shared `post()` helper.
 */
import type { NormalizedRequest, NormalizedResponse, ProviderName } from '../core/types.js';

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Whether the error is transient (safe to retry). */
    public readonly retryable: boolean,
    public readonly provider: ProviderName,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

export abstract class BaseProvider {
  abstract readonly name: ProviderName;

  /** Implemented by each concrete provider. */
  protected abstract send(req: NormalizedRequest): Promise<NormalizedResponse>;

  /**
   * Public entry point. Wraps `send()` with retry + exponential backoff +
   * full jitter to prevent thundering-herd retries after a provider hiccup.
   */
  async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.send(req);
      } catch (err) {
        lastError = err;
        if (!isRetryable(err) || attempt === MAX_RETRIES - 1) throw err;
        const delay = jitter(BASE_DELAY_MS * 2 ** attempt);
        await sleep(delay);
      }
    }
    throw lastError;
  }

  /**
   * Convenience wrapper for POST requests shared by all providers.
   * Normalises HTTP errors into ProviderError with a retryable flag.
   */
  protected async post<T>(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError(
        `${response.status} ${response.statusText}: ${text}`,
        response.status,
        retryable,
        this.name,
      );
    }

    return response.json() as Promise<T>;
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ProviderError) return err.retryable;
  if (err instanceof TypeError) return true; // Network errors (ECONNREFUSED, etc.)
  return false;
}

function jitter(ms: number): number {
  return Math.random() * ms;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
