/**
 * Tests for registerProvider() and registerPrompt() — the v1.1.0 extensibility APIs.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerProvider,
  getProvider,
  resetProviderRegistry,
} from "../providers/registry.js";
import { registerPrompt, getPrompt, listPrompts } from "../prompts/registry.js";
import { BaseProvider } from "../providers/base.provider.js";
import type { NormalizedRequest, NormalizedResponse } from "../core/types.js";

// ─── Minimal stub provider ─────────────────────────────────────────────────

class StubProvider extends BaseProvider {
  readonly name = "stub";
  readonly calls: NormalizedRequest[] = [];

  protected async send(req: NormalizedRequest): Promise<NormalizedResponse> {
    this.calls.push(req);
    return {
      output: `stub:${req.prompt}`,
      inputTokens: 5,
      outputTokens: 5,
      finishReason: "stop",
    };
  }
}

// ─── registerProvider tests ────────────────────────────────────────────────

describe("registerProvider", () => {
  beforeEach(() => resetProviderRegistry());

  test("registered provider is returned by getProvider", () => {
    const stub = new StubProvider();
    registerProvider("stub", () => stub);
    const p = getProvider("stub" as never);
    assert.strictEqual(p, stub);
  });

  test("factory is called lazily on first getProvider call", () => {
    let called = 0;
    registerProvider("lazy", () => {
      called++;
      return new StubProvider();
    });
    assert.equal(called, 0);
    getProvider("lazy" as never);
    assert.equal(called, 1);
    getProvider("lazy" as never); // second call uses cached instance
    assert.equal(called, 1);
  });

  test("re-registering clears the cached instance", () => {
    const stub1 = new StubProvider();
    const stub2 = new StubProvider();
    registerProvider("reinit", () => stub1);
    getProvider("reinit" as never); // cache stub1
    registerProvider("reinit", () => stub2); // re-register
    const p = getProvider("reinit" as never);
    assert.strictEqual(p, stub2);
  });

  test("unknown built-in provider throws descriptive error", () => {
    assert.throws(
      () => getProvider("nonexistent" as never),
      (err: Error) => err.message.includes("registerProvider"),
    );
  });

  test("custom provider can be used as a complete call target", async () => {
    const stub = new StubProvider();
    registerProvider("stub", () => stub);
    const p = getProvider("stub" as never);
    const result = await p.complete({
      modelId: "stub-model",
      system: "sys",
      prompt: "hello",
      maxOutputTokens: 100,
      temperature: 0,
    });
    assert.equal(result.output, "stub:hello");
    assert.equal(stub.calls.length, 1);
  });
});

// ─── registerPrompt tests ──────────────────────────────────────────────────

describe("registerPrompt", () => {
  test("registered prompt is returned by getPrompt", () => {
    registerPrompt({
      id: "test-prompt",
      version: 1,
      system: "You are a test assistant.",
    });
    const t = getPrompt("test-prompt");
    assert.equal(t.id, "test-prompt");
    assert.equal(t.system, "You are a test assistant.");
  });

  test("registered prompt appears in listPrompts", () => {
    registerPrompt({
      id: "list-test",
      version: 1,
      system: "Test system.",
    });
    const list = listPrompts();
    assert.ok(list.some((p) => p.id === "list-test"));
  });

  test("latest version is promoted correctly", () => {
    registerPrompt({ id: "versioned", version: 1, system: "v1" });
    registerPrompt({ id: "versioned", version: 2, system: "v2" });
    const latest = getPrompt("versioned");
    assert.equal(latest.system, "v2");
  });

  test("pinned version reference still resolves", () => {
    registerPrompt({ id: "pinned", version: 1, system: "v1" });
    registerPrompt({ id: "pinned", version: 2, system: "v2" });
    const v1 = getPrompt("pinned@1");
    assert.equal(v1.system, "v1");
  });

  test("isLatest flag is correct in listPrompts", () => {
    registerPrompt({ id: "latest-flag", version: 1, system: "v1" });
    registerPrompt({ id: "latest-flag", version: 2, system: "v2" });
    const list = listPrompts();
    const v1 = list.find((p) => p.id === "latest-flag" && p.version === 1);
    const v2 = list.find((p) => p.id === "latest-flag" && p.version === 2);
    assert.equal(v1?.isLatest, false);
    assert.equal(v2?.isLatest, true);
  });

  test("pinnedComplexity and temperature are preserved", () => {
    registerPrompt({
      id: "pinned-complexity",
      version: 1,
      system: "Sys",
      pinnedComplexity: "simple",
      temperature: 0,
    });
    const t = getPrompt("pinned-complexity");
    assert.equal(t.pinnedComplexity, "simple");
    assert.equal(t.temperature, 0);
  });

  test("user template placeholder is preserved", () => {
    registerPrompt({
      id: "with-user",
      version: 1,
      system: "Sys",
      user: "Task: {{task}}\nInput: {{input}}",
    });
    const t = getPrompt("with-user");
    assert.equal(t.user, "Task: {{task}}\nInput: {{input}}");
  });

  test("getPrompt falls back to default for unknown id", () => {
    const t = getPrompt("totally-unknown-id-xyz");
    assert.equal(t.id, "default");
  });
});
