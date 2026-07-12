import { getConfig } from './env';

export interface AgentLensTestingCreateRequest {
  conversationId: string;
  model?: string;
  proxyBaseUrl?: string;
  maxTokens?: number;
  turnGapSeconds?: number;
}

export interface AgentLensTestingTurnResult {
  turn: number;
  status_code: number | null;
  duration_ms: number | null;
  finish_reason: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  prefill_ms: number | null;
  cache_n: number | null;
  error: string | null;
}

export interface AgentLensTestingRun {
  run_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  conversation_id: string;
  model: string;
  proxy_base_url: string;
  turns: AgentLensTestingTurnResult[];
  telemetry: Record<string, unknown>;
  pass_criteria: Record<string, boolean>;
  error: string | null;
}

export type AgentLensTestingErrorCode =
  | 'upstream_unreachable'
  | 'upstream_http'
  | 'upstream_invalid_payload';

export class AgentLensTestingError extends Error {
  code: AgentLensTestingErrorCode;
  statusCode: number | null;

  constructor(message: string, code: AgentLensTestingErrorCode, statusCode: number | null = null) {
    super(message);
    this.name = 'AgentLensTestingError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function isAgentLensTestingError(error: unknown): error is AgentLensTestingError {
  return error instanceof AgentLensTestingError;
}

function buildHeaders() {
  const config = getConfig();
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json'
  };
  if (config.agentlensTestingApiKey?.trim()) {
    headers['x-agentlens-testing-key'] = config.agentlensTestingApiKey.trim();
  }
  return headers;
}

function baseUrl() {
  const config = getConfig();
  if (config.agentlensControlRelayEnabled && config.agentlensControlBaseUrl.trim()) {
    return config.agentlensControlBaseUrl.replace(/\/+$/, '');
  }
  return config.agentlensBaseUrl.replace(/\/+$/, '');
}

function timeoutSignal(timeoutMs: number) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.error_message === 'string' && candidate.error_message.trim()) {
    return candidate.error_message.trim();
  }
  const nested = candidate.error;
  if (nested && typeof nested === 'object') {
    const nestedMsg = (nested as Record<string, unknown>).message;
    if (typeof nestedMsg === 'string' && nestedMsg.trim()) {
      return nestedMsg.trim();
    }
  }
  return null;
}

async function requestJson<T>(path: string, init: RequestInit, operation: string): Promise<T> {
  const url = `${baseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AgentLensTestingError(
      `AgentLens testing ${operation} failed: upstream unreachable (${reason}).`,
      'upstream_unreachable'
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = extractErrorMessage(payload);
    throw new AgentLensTestingError(
      detail
        ? `AgentLens testing ${operation} failed (${response.status}): ${detail}`
        : `AgentLens testing ${operation} failed (${response.status}).`,
      'upstream_http',
      response.status
    );
  }
  if (!payload || typeof payload !== 'object') {
    throw new AgentLensTestingError(
      `AgentLens testing ${operation} failed: invalid upstream payload.`,
      'upstream_invalid_payload',
      response.status
    );
  }
  return payload as T;
}

export async function triggerAgentLensTestingRun(input: AgentLensTestingCreateRequest): Promise<AgentLensTestingRun> {
  const config = getConfig();
  return requestJson<AgentLensTestingRun>(
    '/api/v1/testing/runs',
    {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({
        conversation_id: input.conversationId,
        ...(input.model ? { model: input.model } : {}),
        ...(input.proxyBaseUrl ? { proxy_base_url: input.proxyBaseUrl } : {}),
        ...(typeof input.maxTokens === 'number' ? { max_tokens: input.maxTokens } : {}),
        ...(typeof input.turnGapSeconds === 'number' ? { turn_gap_seconds: input.turnGapSeconds } : {})
      }),
      signal: timeoutSignal(config.agentlensTestingTimeoutMs)
    },
    'trigger'
  );
}

export async function getAgentLensTestingRun(runId: string): Promise<AgentLensTestingRun> {
  const config = getConfig();
  return requestJson<AgentLensTestingRun>(
    `/api/v1/testing/runs/${encodeURIComponent(runId)}`,
    {
      method: 'GET',
      headers: { ...buildHeaders(), 'content-type': 'application/json' },
      signal: timeoutSignal(config.agentlensTestingTimeoutMs)
    },
    'run lookup'
  );
}

export async function listAgentLensTestingRuns(limit = 20): Promise<AgentLensTestingRun[]> {
  const config = getConfig();
  const clamped = Math.min(100, Math.max(1, Math.floor(limit)));
  const payload = await requestJson<unknown>(
    `/api/v1/testing/runs?limit=${clamped}`,
    {
      method: 'GET',
      headers: { ...buildHeaders(), 'content-type': 'application/json' },
      signal: timeoutSignal(config.agentlensTestingTimeoutMs)
    },
    'run list'
  );
  if (!Array.isArray(payload)) {
    throw new AgentLensTestingError(
      'AgentLens testing run list failed: invalid upstream payload.',
      'upstream_invalid_payload'
    );
  }
  return payload as AgentLensTestingRun[];
}

export async function getLatestAgentLensTestingRunForConversation(
  conversationId: string,
  limit = 25
): Promise<AgentLensTestingRun | null> {
  const runs = await listAgentLensTestingRuns(limit);
  return runs.find((run) => run.conversation_id === conversationId) ?? null;
}
