/**
 * Lazy singleton factory for provider instances.
 *
 * Built-in providers (openai, anthropic, local) are created automatically.
 * Third-party providers can be registered at runtime with `registerProvider()`:
 *
 *   import { registerProvider, BaseProvider } from 'smart-ai-router';
 *
 *   class GeminiProvider extends BaseProvider { ... }
 *   registerProvider('gemini', () => new GeminiProvider());
 *
 * Adding a new built-in vendor:
 *   1. Create src/providers/myprovider.provider.ts extending BaseProvider.
 *   2. Add a case to createBuiltinProvider() below.
 *   3. Add credential env vars in src/config/env.ts and .env.example.
 *   4. Add models in src/config/models.ts.
 *   5. Extend the ProviderName union in src/core/types.ts.
 */
import { BaseProvider } from "./base.provider.js";
import { OpenAIProvider } from "./openai.provider.js";
import { AnthropicProvider } from "./anthropic.provider.js";
import { LocalProvider } from "./local.provider.js";
import type { ProviderName } from "../core/types.js";

const instances = new Map<string, BaseProvider>();

/** Custom provider factories registered at runtime via registerProvider(). */
const customFactories = new Map<string, () => BaseProvider>();

/**
 * Register a custom provider factory.
 *
 * The factory is called lazily the first time the provider is requested.
 * Calling registerProvider() with the same name twice replaces the factory
 * and clears the cached instance, so the next call to getProvider() will
 * use the new factory.
 *
 * @param name    - The provider name used in ModelSpec.provider and RunRequest.forceModel.
 * @param factory - A zero-argument function that returns a BaseProvider instance.
 *
 * @example
 * ```typescript
 * import { registerProvider, BaseProvider } from 'smart-ai-router';
 *
 * class GeminiProvider extends BaseProvider {
 *   readonly name = 'gemini' as const;
 *   protected async send(req) { ... }
 * }
 *
 * registerProvider('gemini', () => new GeminiProvider());
 * ```
 */
export function registerProvider(
  name: string,
  factory: () => BaseProvider,
): void {
  customFactories.set(name, factory);
  instances.delete(name); // Clear any cached instance so the new factory is used.
}

export function getProvider(name: ProviderName | string): BaseProvider {
  const cached = instances.get(name);
  if (cached) return cached;

  // Check custom registry first — allows overriding built-ins in tests.
  const customFactory = customFactories.get(name);
  if (customFactory) {
    const provider = customFactory();
    instances.set(name, provider);
    return provider;
  }

  const provider = createBuiltinProvider(name as ProviderName);
  instances.set(name, provider);
  return provider;
}

function createBuiltinProvider(name: ProviderName): BaseProvider {
  switch (name) {
    case "openai":
      return new OpenAIProvider();
    case "anthropic":
      return new AnthropicProvider();
    case "local":
      return new LocalProvider();
    default: {
      const _exhaustive: never = name;
      throw new Error(
        `Unknown provider: "${_exhaustive}". ` +
          `Built-ins: openai, anthropic, local. ` +
          `Use registerProvider() to add a custom provider.`,
      );
    }
  }
}

/** Flush cached instances and custom factories (useful in tests). */
export function resetProviderRegistry(): void {
  instances.clear();
  customFactories.clear();
}
