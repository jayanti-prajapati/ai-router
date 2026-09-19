import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, estimateOutputTokens, computeCost, estimateCost } from '../core/cost.js';
import type { ModelSpec } from '../core/types.js';

const MODEL: ModelSpec = {
  id: 'test-model',
  provider: 'openai',
  tier: 'simple',
  inputCostPerMTok: 1,
  outputCostPerMTok: 4,
  contextWindow: 128_000,
  maxOutputTokens: 4_096,
  avgLatencyMs: 500,
  quality: 0.5,
};

describe('estimateTokens', () => {
  test('empty string returns 0 tokens', () => {
    assert.equal(estimateTokens(''), 0);
  });

  test('rough token estimate for known text', () => {
    // "hello world" = 11 chars → ceil(11/3.7) = 3
    assert.equal(estimateTokens('hello world'), 3);
  });

  test('longer text produces proportionally more tokens', () => {
    const short = estimateTokens('hi');
    const long = estimateTokens('hi'.repeat(100));
    assert.ok(long > short * 50);
  });
});

describe('estimateOutputTokens', () => {
  test('simple tier uses 0.5x ratio', () => {
    assert.equal(estimateOutputTokens(100, 'simple'), 50);
  });

  test('medium tier uses 1.2x ratio', () => {
    assert.equal(estimateOutputTokens(100, 'medium'), 120);
  });

  test('complex tier uses 2.0x ratio', () => {
    assert.equal(estimateOutputTokens(100, 'complex'), 200);
  });
});

describe('computeCost', () => {
  test('computes cost from real token counts', () => {
    // 1000 input @ $1/MTok + 500 output @ $4/MTok = $0.001 + $0.002 = $0.003
    const cost = computeCost(MODEL, 1_000, 500);
    assert.ok(Math.abs(cost - 0.003) < 1e-9);
  });

  test('zero tokens = zero cost', () => {
    assert.equal(computeCost(MODEL, 0, 0), 0);
  });
});

describe('estimateCost', () => {
  test('simple: 1000 input → 500 output estimated', () => {
    const cost = estimateCost(MODEL, 1_000, 'simple');
    const expected = computeCost(MODEL, 1_000, 500);
    assert.ok(Math.abs(cost - expected) < 1e-9);
  });

  test('complex costs more than simple for same input', () => {
    const simple = estimateCost(MODEL, 1_000, 'simple');
    const complex = estimateCost(MODEL, 1_000, 'complex');
    assert.ok(complex > simple);
  });
});
