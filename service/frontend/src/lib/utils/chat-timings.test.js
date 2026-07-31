import test from 'node:test';
import assert from 'node:assert/strict';

import { readTimingSummary, resolvePrefillMs, resolveTtftMs } from './chat-timings.ts';

test('readTimingSummary reports effective and actual prefill rates', () => {
	// 100 prompt tokens, 50% cached, 1s prefill → 100 eff t/s, 50 actual t/s
	const summary = readTimingSummary({
		prompt_n: 100,
		cache_n: 50,
		prompt_ms: 1_000,
		predicted_n: 10,
		predicted_ms: 500
	});

	assert.equal(summary.cacheTokens, 50);
	assert.equal(summary.effectivePromptTokensPerSecond, 100);
	assert.equal(summary.actualPromptTokensPerSecond, 50);
	assert.equal(summary.promptTokensPerSecond, 50);
});

test('readTimingSummary treats cached_prefix_tokens as cached tokens', () => {
	const summary = readTimingSummary({
		usage: {
			timings: {
				prefill_ms: 29_100,
				cached_prefix_tokens: 17_848,
				decode_ms: 900
			}
		},
		prompt_n: 23_765,
		predicted_n: 20,
		predicted_ms: 900
	});

	assert.equal(summary.cacheTokens, 17_848);
	assert.equal(summary.promptMs, 29_100);
	assert.equal(resolvePrefillMs(summary), 29_100);
	assert.equal(summary.actualPromptTokensPerSecond, (23_765 - 17_848) / 29.1);
	assert.equal(summary.effectivePromptTokensPerSecond, 23_765 / 29.1);
});

test('readTimingSummary treats prefix_len as cached tokens', () => {
	const summary = readTimingSummary({
		prompt_n: 988,
		prefix_len: 972,
		prompt_ms: 60,
		predicted_n: 1,
		predicted_ms: 82
	});

	assert.equal(summary.cacheTokens, 972);
	assert.equal(summary.actualPromptTokensPerSecond, (988 - 972) / 0.06);
	assert.equal(summary.effectivePromptTokensPerSecond, 988 / 0.06);
});

test('readTimingSummary uses matching rates when no cache is reported', () => {
	const summary = readTimingSummary({
		prompt_n: 988,
		prompt_ms: 1_340,
		predicted_n: 1,
		predicted_ms: 74
	});

	assert.equal(summary.cacheTokens, null);
	assert.equal(summary.actualPromptTokensPerSecond, 988 / 1.34);
	assert.equal(summary.effectivePromptTokensPerSecond, 988 / 1.34);
});

test('readTimingSummary reads prefill_ms as prompt time, not TTFT', () => {
	const summary = readTimingSummary({
		usage: {
			timings: {
				prefill_ms: 89_605,
				decode_tokens_per_sec: 13.7
			},
			prompt_tokens: 20_602,
			completion_tokens: 11
		},
		predicted_n: 11,
		predicted_ms: 803
	});

	assert.equal(summary.promptMs, 89_605);
	assert.equal(resolvePrefillMs(summary), 89_605);
	assert.equal(summary.ttftMs, null);
	assert.equal(resolveTtftMs(summary), null);
});

test('resolveTtftMs stays null when only prefill is present', () => {
	const summary = readTimingSummary({
		prompt_n: 446,
		prompt_ms: 1_200,
		predicted_n: 8,
		predicted_ms: 886
	});

	assert.equal(summary.ttftMs, null);
	assert.equal(resolveTtftMs(summary), null);
});
