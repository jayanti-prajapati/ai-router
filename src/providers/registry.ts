/**
 * Lazy singleton factory for provider instances.
 *
 * Adding a new vendor:
 *   1. Create src/providers/myprovider.provider.ts extending BaseProvider.
 *   2. Add a case here.
 *   3. Add credential env vars in src/config/env.ts and .env.example.
 *   4. Add models in src/config/models.ts.
 *   5. Extend the ProviderName union in src/core/types.ts.
 */
import { BaseProvider } from "./base.provider.js";
import { OpenAIProvider } from "./openai.provider.js";
import { AnthropicProvider } from "./anthropic.provider.js";
import { LocalProvider } from "./local.provider.js";
import type { ProviderName } from "../core/types.js";

const instances = new Map<ProviderName, BaseProvider>();

export function getProvider(name: ProviderName): BaseProvider {
  const cached = instances.get(name);
  if (cached) return cached;

  const provider = createProvider(name);
  instances.set(name, provider);
  return provider;
}

function createProvider(name: ProviderName): BaseProvider {
  switch (name) {
    case "openai":
      return new OpenAIProvider();
    case "anthropic":
      return new AnthropicProvider();
    case "local":
      return new LocalProvider();
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}

/** Flush cached instances (useful in tests to reinitialise with different env). */
export function resetProviderRegistry(): void {
  instances.clear();
}
