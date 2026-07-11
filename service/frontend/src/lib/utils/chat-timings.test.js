import test from 'node:test';
import assert from 'node:assert/strict';

import { readTimingSummary, resolveTtftMs } from './chat-timings.ts';

test('readTimingSummary excludes cached tokens from prefill t/s', () => {
	const summary = readTimingSummary({
		prompt_n: 23_118,
		cache_n: 22_738,
		prompt_ms: 1_300,
		prompt_per_second: 17_783.08,
		predicted_n: 30,
		predicted_ms: 1_400
	});

	assert.equal(summary.cacheTokens, 22_738);
	assert.equal(summary.promptTokensPerSecond, (23_118 - 22_738) / 1.3);
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
	assert.equal(summary.promptTokensPerSecond, (988 - 972) / 0.06);
});

test('readTimingSummary uses uncached tokens when no cache is reported', () => {
	const summary = readTimingSummary({
		prompt_n: 988,
		prompt_ms: 1_340,
		predicted_n: 1,
		predicted_ms: 74
	});

	assert.equal(summary.cacheTokens, null);
	assert.equal(summary.promptTokensPerSecond, 988 / 1.34);
});

test('readTimingSummary reads prefill_ms from nested usage.timings', () => {
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

	assert.equal(summary.ttftMs, 89_605);
	assert.equal(resolveTtftMs(summary), 89_605);
});

test('resolveTtftMs falls back to prompt_ms when ttft is absent', () => {
	const summary = readTimingSummary({
		prompt_n: 446,
		prompt_ms: 1_200,
		predicted_n: 8,
		predicted_ms: 886
	});

	assert.equal(summary.ttftMs, null);
	assert.equal(resolveTtftMs(summary), 1_200);
});
