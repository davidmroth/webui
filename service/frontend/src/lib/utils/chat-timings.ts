export interface TimingSummary {
  cacheTokens: number | null;
  promptTokens: number | null;
  promptMs: number | null;
  promptTokensPerSecond: number | null;
  generatedTokens: number | null;
  generatedMs: number | null;
  generatedTokensPerSecond: number | null;
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

  const verbose = toRecord(root.__verbose);
  if (verbose) {
    push(verbose.timings);
    push(verbose.usage);
  }

  const response = toRecord(root.response);
  if (response) {
    push(response.timings);
    push(response.usage);
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
  const cacheTokens = readTimingNumber(value, ['cache_n', 'cache_tokens']);
  const promptTokens = readTimingNumber(value, [
    'prompt_n',
    'prompt_tokens',
    'prompt_eval_count',
    'input_tokens',
    'n_prompt_tokens'
  ]);
  let promptMs = readTimingDurationMs(value, [
    'prompt_ms',
    'prompt_duration_ms',
    'prompt_eval_ms',
    'prompt_eval_duration',
    'prompt_duration'
  ]);
  const promptTokensPerSecond = readTimingNumber(value, ['prompt_per_second']);
  if (promptMs == null && promptTokens != null && promptTokensPerSecond != null && promptTokensPerSecond > 0) {
    promptMs = (promptTokens / promptTokensPerSecond) * 1000;
  }

  const generatedTokens = readTimingNumber(value, [
    'predicted_n',
    'completion_tokens',
    'eval_count',
    'output_tokens'
  ]);
  let generatedMs = readTimingDurationMs(value, [
    'predicted_ms',
    'completion_ms',
    'output_duration_ms',
    'eval_ms',
    'eval_duration',
    'completion_duration'
  ]);
  let generatedTokensPerSecond = readTimingNumber(value, [
    'predicted_per_second',
    'tokens_per_second',
    'completion_tokens_per_second',
    'output_tokens_per_second'
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
  const contextUsed =
    explicitContextUsed ??
    (promptTokens != null || cacheTokens != null ? (promptTokens ?? 0) + (cacheTokens ?? 0) : null);

  return {
    cacheTokens,
    promptTokens,
    promptMs,
    promptTokensPerSecond:
      promptTokensPerSecond ??
      (promptTokens != null && promptMs != null && promptMs > 0 ? promptTokens / (promptMs / 1000) : null),
    generatedTokens,
    generatedMs,
    generatedTokensPerSecond,
    contextUsed,
    contextTotal,
    outputMax
  };
}