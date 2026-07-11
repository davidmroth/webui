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
  return getConfig().agentlensBaseUrl.replace(/\/+$/, '');
}

function timeoutSignal(timeoutMs: number) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

export async function triggerAgentLensTestingRun(input: AgentLensTestingCreateRequest): Promise<AgentLensTestingRun> {
  const config = getConfig();
  const response = await fetch(`${baseUrl()}/api/v1/testing/runs`, {
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
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== 'object') {
    throw new Error(`AgentLens testing trigger failed (${response.status}).`);
  }
  return payload as AgentLensTestingRun;
}

export async function getAgentLensTestingRun(runId: string): Promise<AgentLensTestingRun> {
  const config = getConfig();
  const response = await fetch(`${baseUrl()}/api/v1/testing/runs/${encodeURIComponent(runId)}`, {
    method: 'GET',
    headers: { ...buildHeaders(), 'content-type': 'application/json' },
    signal: timeoutSignal(config.agentlensTestingTimeoutMs)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== 'object') {
    throw new Error(`AgentLens testing run lookup failed (${response.status}).`);
  }
  return payload as AgentLensTestingRun;
}

export async function listAgentLensTestingRuns(limit = 20): Promise<AgentLensTestingRun[]> {
  const config = getConfig();
  const clamped = Math.min(100, Math.max(1, Math.floor(limit)));
  const response = await fetch(`${baseUrl()}/api/v1/testing/runs?limit=${clamped}`, {
    method: 'GET',
    headers: { ...buildHeaders(), 'content-type': 'application/json' },
    signal: timeoutSignal(config.agentlensTestingTimeoutMs)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload)) {
    throw new Error(`AgentLens testing run list failed (${response.status}).`);
  }
  return payload as AgentLensTestingRun[];
}
