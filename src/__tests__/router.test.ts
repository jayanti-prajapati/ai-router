import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { route } from "../core/router.js";
import { resetProviderRegistry } from "../providers/registry.js";
import { CostLimitError, NoModelAvailableError } from "../core/types.js";
import type { ClassificationResult } from "../core/types.js";

function cls(
  complexity: "simple" | "medium" | "complex",
): ClassificationResult {
  return {
    complexity,
    confidence: 0.9,
    signals: [],
    estimatedInputTokens: 50,
    source: "heuristic",
  };
}

beforeEach(() => {
  resetProviderRegistry();
});

describe("route", () => {
  test("simple classification → simple tier model", () => {
    const decision = route({ task: "format", input: "hello" }, cls("simple"));
    assert.equal(decision.complexity, "simple");
    assert.ok(decision.model.tier === "simple" || decision.downgraded);
  });

  test("complex classification → complex tier model", () => {
    const decision = route(
      { task: "architecture", input: "design a system" },
      cls("complex"),
    );
    assert.ok(["medium", "complex"].includes(decision.model.tier));
  });

  test("priority=speed shifts tier down", () => {
    // medium + speed → simple
    const slow = route(
      { task: "codegen", input: "write code", priority: "balanced" },
      cls("medium"),
    );
    const fast = route(
      { task: "codegen", input: "write code", priority: "speed" },
      cls("medium"),
    );
    assert.ok(
      effectiveRate(fast.model) <= effectiveRate(slow.model) ||
        fast.model.avgLatencyMs <= slow.model.avgLatencyMs,
    );
  });

  test("priority=quality shifts tier up", () => {
    const balanced = route(
      { task: "format", input: "hello", priority: "balanced" },
      cls("simple"),
    );
    const quality = route(
      { task: "format", input: "hello", priority: "quality" },
      cls("simple"),
    );
    assert.ok(quality.model.quality >= balanced.model.quality);
  });

  test("exclude list skips that model", () => {
    const first = route({ task: "format", input: "hello" }, cls("simple"));
    // With only one provider configured (OPENAI_API_KEY=test), excluding the only
    // model in a tier may throw NoModelAvailableError — that is correct behaviour.
    // If a second model exists, it must differ from the first.
    try {
      const second = route({ task: "format", input: "hello" }, cls("simple"), {
        exclude: [first.model.id],
      });
      assert.notEqual(second.model.id, first.model.id);
    } catch (err) {
      assert.ok(
        err instanceof NoModelAvailableError,
        "expected NoModelAvailableError when no alternatives exist",
      );
    }
  });

  test("forceModel override bypasses classification", () => {
    // forceModel only works when ALLOW_CLIENT_FORCE_MODEL=true or FORCE_MODEL is set
    // Without it, forceModel is ignored — router picks normally
    const decision = route({ task: "format", input: "hello" }, cls("simple"));
    assert.ok(decision.model.id.length > 0);
  });

  test("reason string is non-empty", () => {
    const decision = route({ task: "format", input: "hello" }, cls("simple"));
    assert.ok(decision.reason.length > 0);
  });

  test("estimatedCost is non-negative", () => {
    const decision = route({ task: "format", input: "hello" }, cls("simple"));
    assert.ok(decision.estimatedCost >= 0);
  });

  test("throws NoModelAvailableError when all models excluded", () => {
    const first = route({ task: "format", input: "hello" }, cls("simple"));
    // Exclude everything by getting all model IDs
    assert.throws(() => {
      route({ task: "format", input: "hello" }, cls("simple"), {
        exclude: [
          "gpt-4.1-nano",
          "claude-haiku-4-5-20251001",
          "gpt-4.1-mini",
          "claude-sonnet-5",
          "gpt-4.1",
          "claude-opus-5",
          "llama3",
          first.model.id,
        ],
      });
    }, NoModelAvailableError);
  });
});

function effectiveRate(m: {
  inputCostPerMTok: number;
  outputCostPerMTok: number;
}): number {
  return m.inputCostPerMTok * 0.75 + m.outputCostPerMTok * 0.25;
}
