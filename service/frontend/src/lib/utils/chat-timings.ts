export interface TimingSummary {
  cacheTokens: number | null;
  promptTokens: number | null;
  promptMs: number | null;
  /** Uncached tokens / prefill time — GPU work actually done. */
  actualPromptTokensPerSecond: number | null;
  /** All prompt tokens / prefill time — includes KV-cache benefit. */
  effectivePromptTokensPerSecond: number | null;
  /**
   * @deprecated Prefer actualPromptTokensPerSecond. Kept as the actual
   * (uncached) rate for older callers.
   */
  promptTokensPerSecond: number | null;
  generatedTokens: number | null;
  generatedMs: number | null;
  generatedTokensPerSecond: number | null;
  ttftMs: number | null;
  contextUsed: number | null;
  contextTotal: number | null;
  outputMax: number | null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function collectTimingScopes(value: unknown): Array<Record<string, unknown>> {
  const scopes: Array<Record<string, unknown>> = [];
  const seen = new Set<Record<string, unknown>>();

  const push = (candidate: unknown) => {
    const record = toRecord(candidate);
    if (!record || seen.has(record)) {
      return;
    }

    seen.add(record);
    scopes.push(record);
  };

  const root = toRecord(value);
  if (!root) {
    return scopes;
  }

  push(root);
  push(root.timings);
  push(root.usage);

  const usage = toRecord(root.usage);
  if (usage) {
    push(usage.timings);
  }

  const verbose = toRecord(root.__verbose);
  if (verbose) {
    push(verbose.timings);
    push(verbose.usage);
    const verboseUsage = toRecord(verbose.usage);
    if (verboseUsage) {
      push(verboseUsage.timings);
    }
  }

  const response = toRecord(root.response);
  if (response) {
    push(response.timings);
    push(response.usage);
    const responseUsage = toRecord(response.usage);
    if (responseUsage) {
      push(responseUsage.timings);
    }
  }

  const data = toRecord(root.data);
  if (data) {
    const dataResponse = toRecord(data.response);
    if (dataResponse) {
      push(dataResponse.timings);
      push(dataResponse.usage);
    }
  }

  const agentic = toRecord(root.agentic);
  if (agentic) {
    push(agentic.llm);

    const perTurn = Array.isArray(agentic.perTurn) ? agentic.perTurn : [];
    const lastTurn = perTurn.length > 0 ? toRecord(perTurn[perTurn.length - 1]) : null;
    if (lastTurn) {
      push(lastTurn.llm);
    }
  }

  return scopes;
}

export function readTimingNumber(value: unknown, keys: string[]): number | null {
  for (const scope of collectTimingScopes(value)) {
    for (const key of keys) {
      const numeric = toFiniteNumber(scope[key]);
      if (numeric != null) {
        return numeric;
      }
    }
  }

  return null;
}

export function readTimingDurationMs(value: unknown, keys: string[]): number | null {
  for (const scope of collectTimingScopes(value)) {
    for (const key of keys) {
      const numeric = toFiniteNumber(scope[key]);
      if (numeric == null) {
        continue;
      }

      if (key.endsWith('_duration') || key === 'duration') {
        if (numeric >= 1_000_000_000) {
          return numeric / 1_000_000;
        }
        if (numeric >= 100_000) {
          return numeric / 1_000;
        }
      }

      return numeric;
    }
  }

  return null;
}

export function readTimingSummary(value: unknown): TimingSummary {
  const cacheTokens = readTimingNumber(value, [
    'cache_n',
    'cache_tokens',
    'cached_prefix_tokens',
    'prefix_len'
  ]);
  const promptTokens = readTimingNumber(value, [
    'prompt_n',
    'prompt_tokens',
    'prompt_eval_count',
    'input_tokens',
    'n_prompt_tokens'
  ]);
  let promptMs = readTimingDurationMs(value, [
    'prompt_ms',
    'prefill_ms',
    'prompt_duration_ms',
    'prompt_eval_ms',
    'prompt_eval_duration',
    'prompt_duration'
  ]);
  // Ignore payload prompt_per_second for rate math — engines disagree on
  // whether it counts cached tokens. Derive both rates from tokens + time.
  if (
    promptMs == null &&
    promptTokens != null
  ) {
    const reportedRate = readTimingNumber(value, ['prompt_per_second']);
    if (reportedRate != null && reportedRate > 0) {
      promptMs = (promptTokens / reportedRate) * 1000;
    }
  }

  // Sub-50ms "prefill" for a real-sized prompt is almost always wire TTFT
  // from a failed/empty completion — do not invent million-t/s rates.
  const prefillMsReliable =
    promptMs != null &&
    promptMs > 0 &&
    (promptTokens == null || promptTokens < 100 || promptMs >= 50);
  const reliablePromptMs = prefillMsReliable ? promptMs : null;

  const promptSeconds =
    reliablePromptMs != null && reliablePromptMs > 0
      ? reliablePromptMs / 1000
      : null;
  const uncachedTokens =
    promptTokens != null
      ? Math.max(promptTokens - (cacheTokens ?? 0), 0)
      : null;

  // Effective: full prompt ÷ wall prefill (cache makes this look faster).
  // Actual: only tokens the GPU prefilling this turn ÷ wall prefill.
  const effectivePromptTokensPerSecond =
    promptTokens != null && promptSeconds != null
      ? promptTokens / promptSeconds
      : null;
  const actualPromptTokensPerSecond =
    uncachedTokens != null && promptSeconds != null
      ? uncachedTokens > 0
        ? uncachedTokens / promptSeconds
        : null
      : effectivePromptTokensPerSecond;

  const generatedTokens = readTimingNumber(value, [
    'predicted_n',
    'completion_tokens',
    'eval_count',
    'output_tokens'
  ]);
  let generatedMs = readTimingDurationMs(value, [
    'predicted_ms',
    'completion_ms',
    'decode_ms',
    'output_duration_ms',
    'eval_ms',
    'eval_duration',
    'completion_duration'
  ]);
  let generatedTokensPerSecond = readTimingNumber(value, [
    'predicted_per_second',
    'tokens_per_second',
    'completion_tokens_per_second',
    'output_tokens_per_second',
    'decode_tokens_per_sec'
  ]);
  if (generatedMs == null && generatedTokens != null && generatedTokensPerSecond != null && generatedTokensPerSecond > 0) {
    generatedMs = (generatedTokens / generatedTokensPerSecond) * 1000;
  }
  if (
    generatedTokensPerSecond == null &&
    generatedTokens != null &&
    generatedMs != null &&
    generatedMs > 0
  ) {
    generatedTokensPerSecond = generatedTokens / (generatedMs / 1000);
  }

  const explicitContextUsed = readTimingNumber(value, ['context_used', 'contextUsed']);
  const contextTotal = readTimingNumber(value, ['n_ctx', 'context_total', 'contextTotal']);
  const outputMax = readTimingNumber(value, ['n_predict', 'max_tokens', 'output_max', 'outputTokensMax']);
  // Wire/client first-token only — never fall back to prefill_ms (that is Reading).
  const ttftMs = readTimingDurationMs(value, [
    'ttft_ms',
    'time_to_first_token_ms',
    'ttfb_ms'
  ]);
  const contextUsed =
    explicitContextUsed ??
    (promptTokens != null ? promptTokens : null);

  return {
    cacheTokens: prefillMsReliable ? cacheTokens : null,
    promptTokens,
    promptMs: reliablePromptMs,
    actualPromptTokensPerSecond,
    effectivePromptTokensPerSecond,
    promptTokensPerSecond: actualPromptTokensPerSecond,
    generatedTokens,
    generatedMs,
    generatedTokensPerSecond,
    ttftMs,
    contextUsed,
    contextTotal,
    outputMax
  };
}

/** Engine prompt prefill (`prompt_ms`), not time-to-first-token. */
export function resolvePrefillMs(summary: TimingSummary): number | null {
  if (summary.promptMs != null && summary.promptMs > 0) {
    return summary.promptMs;
  }
  return null;
}

/**
 * True TTFT: proxy wire ttfb / ttft_ms when present.
 * Does not fall back to prefill — Prefill and TTFT are separate metrics.
 */
export function resolveTtftMs(summary: TimingSummary): number | null {
  if (summary.ttftMs != null && summary.ttftMs > 0) {
    return summary.ttftMs;
  }
  return null;
}