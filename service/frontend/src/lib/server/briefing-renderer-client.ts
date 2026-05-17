export interface BriefingRendererClientConfig {
  baseUrl: string;
  serviceToken?: string;
  fetchImpl?: typeof fetch;
}

interface RendererJobAccepted {
  job_id: string;
  status: string;
  status_url: string;
  result_url: string;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

function buildRegenerateUrl(baseUrl: string, jobId: string) {
  return `${normalizeBaseUrl(baseUrl)}/v1/briefings/${encodeURIComponent(jobId)}/regenerate`;
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { detail: text };
  }
}

function buildErrorMessage(status: number, payload: unknown) {
  if (payload && typeof payload === 'object') {
    if ('detail' in payload && typeof payload.detail === 'string') {
      return `Briefing regenerate request failed (${status}): ${payload.detail}`;
    }

    if ('error' in payload && typeof payload.error === 'string') {
      return `Briefing regenerate request failed (${status}): ${payload.error}`;
    }
  }

  return `Briefing regenerate request failed with status ${status}.`;
}

export async function regenerateBriefingJob(
  config: BriefingRendererClientConfig,
  jobId: string
): Promise<{ jobId: string; status: string }> {
  const normalizedBaseUrl = config.baseUrl.trim();
  const normalizedJobId = jobId.trim();

  if (!normalizedBaseUrl) {
    throw new Error('BRIEFING_RENDERER_BASE_URL is not configured for briefing regeneration.');
  }

  if (!normalizedJobId) {
    throw new Error('A briefing job id is required.');
  }

  const headers: Record<string, string> = {};
  if (config.serviceToken?.trim()) {
    headers.Authorization = `Bearer ${config.serviceToken.trim()}`;
  }

  const response = await (config.fetchImpl ?? fetch)(buildRegenerateUrl(normalizedBaseUrl, normalizedJobId), {
    method: 'POST',
    headers
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(response.status, payload));
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.job_id !== 'string' ||
    typeof payload.status !== 'string'
  ) {
    throw new Error('Briefing renderer returned an unexpected regenerate response payload.');
  }

  return {
    jobId: payload.job_id,
    status: payload.status
  } satisfies { jobId: string; status: string };
}