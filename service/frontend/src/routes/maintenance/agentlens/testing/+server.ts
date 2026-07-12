import { json } from '@sveltejs/kit';
import { requireDiagnosticsAccess } from '$server/diagnostics-auth';
import {
  isAgentLensTestingError,
  listAgentLensTestingRuns,
  triggerAgentLensTestingRun
} from '$server/agentlens-testing';

const NO_STORE_HEADERS = {
  'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  pragma: 'no-cache',
  expires: '0'
};

function parseLimit(url: URL) {
  const limit = Number(url.searchParams.get('limit') ?? 20);
  return Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 20;
}

export async function GET(event) {
  const authFailure = requireDiagnosticsAccess(event);
  if (authFailure) {
    return authFailure;
  }

  try {
    return json(
      {
        success: true,
        runs: await listAgentLensTestingRuns(parseLimit(event.url))
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    if (isAgentLensTestingError(error) && error.code === 'upstream_unreachable') {
      return json(
        {
          success: false,
          error_code: 'AGENTLENS_CONTROL_PLANE_UNREACHABLE',
          error_message: error.message
        },
        { status: 503, headers: NO_STORE_HEADERS }
      );
    }
    return json(
      {
        success: false,
        error_code: 'AGENTLENS_TESTING_LIST_FAILED',
        error_message: error instanceof Error ? error.message : 'Failed to list AgentLens testing runs.'
      },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(event) {
  const authFailure = requireDiagnosticsAccess(event);
  if (authFailure) {
    return authFailure;
  }

  const body = await event.request.json().catch(() => null);
  const conversationId =
    body && typeof body.conversationId === 'string' ? body.conversationId.trim() : '';

  if (!conversationId) {
    return json(
      {
        success: false,
        error_code: 'AGENTLENS_TESTING_INVALID_INPUT',
        error_message: 'conversationId is required.'
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const run = await triggerAgentLensTestingRun({
      conversationId,
      ...(body && typeof body.model === 'string' && body.model.trim()
        ? { model: body.model.trim() }
        : {}),
      ...(body && typeof body.proxyBaseUrl === 'string' && body.proxyBaseUrl.trim()
        ? { proxyBaseUrl: body.proxyBaseUrl.trim() }
        : {}),
      ...(body && typeof body.maxTokens === 'number' ? { maxTokens: body.maxTokens } : {}),
      ...(body && typeof body.turnGapSeconds === 'number'
        ? { turnGapSeconds: body.turnGapSeconds }
        : {})
    });

    return json(
      {
        success: true,
        run
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    if (isAgentLensTestingError(error) && error.code === 'upstream_unreachable') {
      return json(
        {
          success: false,
          error_code: 'AGENTLENS_CONTROL_PLANE_UNREACHABLE',
          error_message: error.message
        },
        { status: 503, headers: NO_STORE_HEADERS }
      );
    }
    return json(
      {
        success: false,
        error_code: 'AGENTLENS_TESTING_TRIGGER_FAILED',
        error_message: error instanceof Error ? error.message : 'Failed to trigger AgentLens testing run.'
      },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
