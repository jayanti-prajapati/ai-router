import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scoreOutput } from '../core/quality.js';
import type { NormalizedResponse } from '../core/types.js';

function resp(output: string, finishReason: NormalizedResponse['finishReason'] = 'stop'): NormalizedResponse {
  return { output, inputTokens: 10, outputTokens: 10, finishReason };
}

describe('scoreOutput', () => {
  test('empty response → score 0', () => {
    const r = scoreOutput(resp(''));
    assert.equal(r.score, 0);
    assert.ok(r.reasons.includes('empty response'));
  });

  test('very short response → penalty', () => {
    const r = scoreOutput(resp('ok'));
    assert.ok(r.score < 1);
    assert.ok(r.reasons.some((s) => s.includes('very short')));
  });

  test('normal response → score 1', () => {
    const r = scoreOutput(resp('This is a well-formed, complete and helpful response.'));
    assert.equal(r.score, 1);
    assert.equal(r.reasons.length, 0);
  });

  test('truncated response → penalty', () => {
    const r = scoreOutput(resp('Some response that got cut', 'length'));
    assert.ok(r.score < 1);
    assert.ok(r.reasons.some((s) => s.includes('truncated')));
  });

  test('refusal pattern → penalty', () => {
    const r = scoreOutput(resp("I'm sorry, I cannot help with that."));
    assert.ok(r.score < 1);
    assert.ok(r.reasons.some((s) => s.includes('refusal')));
  });

  test('repetition loop → penalty', () => {
    const looping = 'abcdefghijklmnopqrst'.repeat(10);
    const r = scoreOutput(resp(looping));
    assert.ok(r.score < 1);
    assert.ok(r.reasons.some((s) => s.includes('repetition')));
  });

  test('valid JSON when expectJson=true → no penalty', () => {
    const r = scoreOutput(resp('{"name":"Ada","age":35}'), { expectJson: true });
    assert.equal(r.score, 1);
  });

  test('missing JSON when expectJson=true → penalty', () => {
    const r = scoreOutput(resp('Here is the data: name is Ada'), { expectJson: true });
    assert.ok(r.score < 1);
    assert.ok(r.reasons.some((s) => s.includes('JSON')));
  });

  test('malformed JSON when expectJson=true → penalty', () => {
    const r = scoreOutput(resp('{"name": "Ada", broken json}'), { expectJson: true });
    assert.ok(r.score < 1);
    assert.ok(r.reasons.some((s) => s.includes('JSON')));
  });

  test('score is clamped between 0 and 1', () => {
    // Multiple penalties should not go below 0
    const r = scoreOutput(resp('ok', 'length'), { expectJson: true });
    assert.ok(r.score >= 0);
    assert.ok(r.score <= 1);
  });
});
