import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../core/classifier.js";
import { Task } from "../core/types.js";

// classify() is async (may call meta-model), but with ENABLE_META_CLASSIFIER=false
// (the default) it returns synchronously after the heuristic.

describe("classify — heuristic", () => {
  test('task hint "format" → simple', async () => {
    const r = await classify({
      task: "format",
      input: "Convert to JSON: name Alice.",
    });
    assert.equal(r.complexity, "simple");
    assert.equal(r.source, "heuristic");
  });

  test('task hint "summarize" → simple', async () => {
    const r = await classify({
      task: "summarize",
      input: "Summarize this document.",
    });
    assert.equal(r.complexity, "simple");
  });

  test('task hint "codegen" → medium', async () => {
    const r = await classify({
      task: "codegen",
      input: "Write a TypeScript debounce function.",
    });
    assert.equal(r.complexity, "medium");
  });

  test('task hint "architecture" → complex', async () => {
    const r = await classify({
      task: "architecture",
      input: "Design a distributed payment system with 100k TPS.",
    });
    assert.equal(r.complexity, "complex");
  });

  test("architecture keyword → medium or complex", async () => {
    const r = await classify({
      task: "explain",
      input: "Design the architecture for a scalable microservices system.",
    });
    assert.ok(["medium", "complex"].includes(r.complexity));
  });

  test("translate keyword → simple", async () => {
    // Task.EXPLAIN has no classifier hint — the 'translate' keyword in the input drives the result.
    const r = await classify({
      task: Task.EXPLAIN,
      input: "Translate this sentence to French: hello world.",
    });
    assert.equal(r.complexity, "simple");
  });

  test("very long prompt (>6000 chars) → complex", async () => {
    const r = await classify({ task: "explain", input: "x".repeat(25_000) });
    assert.equal(r.complexity, "complex");
  });

  test("signals array is populated", async () => {
    const r = await classify({ task: "format", input: "hello" });
    assert.ok(Array.isArray(r.signals));
    assert.ok(r.signals.length > 0);
  });

  test("confidence is between 0 and 1", async () => {
    const r = await classify({ task: "format", input: "hello" });
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
  });

  test("estimatedInputTokens is positive", async () => {
    const r = await classify({ task: "format", input: "hello world" });
    assert.ok(r.estimatedInputTokens > 0);
  });

  test("code generation verb + technical noun detected in signals", async () => {
    // Task.EXPLAIN has no classifier hint — generation-verb + technical-noun in the input drives the signal.
    const r = await classify({
      task: Task.EXPLAIN,
      input: "Write a service class that handles authentication middleware.",
    });
    assert.ok(
      r.signals.some(
        (s) => s.includes("code/artifact generation") || s.includes("score="),
      ),
    );
  });
});
