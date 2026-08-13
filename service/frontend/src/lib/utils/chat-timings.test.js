import test from 'node:test';
import assert from 'node:assert/strict';

import { readTimingSummary } from './chat-timings.ts';

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

test('readTimingSummary parses hermes_timings fingerprint (llama.cpp)', () => {
	const summary = readTimingSummary({
		system_fingerprint: 'hermes_timings:prompt_ms=42,predicted_ms=80,predicted_n=20,prompt_n=100'
	});
	assert.equal(summary.promptMs, 42);
	assert.equal(summary.generatedMs, 80);
	assert.equal(summary.generatedTokens, 20);
	assert.equal(summary.promptTokens, 100);
});

test('readTimingSummary still reads lucebox keys after fingerprint support', () => {
	const summary = readTimingSummary({
		prefill_ms: 55,
		decode_ms: 120,
		decode_tokens_per_sec: 40,
		prompt_n: 10,
		predicted_n: 8
	});
	assert.equal(summary.promptMs, 55);
	assert.equal(summary.generatedMs, 120);
	assert.equal(summary.generatedTokensPerSecond, 40);
});
