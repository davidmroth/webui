import { json } from '@sveltejs/kit';
import { requireDiagnosticsAccess } from '$server/diagnostics-auth';
import { getAgentLensTestingRun } from '$server/agentlens-testing';

const NO_STORE_HEADERS = {
  'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  pragma: 'no-cache',
  expires: '0'
};

export async function GET(event) {
  const authFailure = requireDiagnosticsAccess(event);
  if (authFailure) {
    return authFailure;
  }

  try {
    const run = await getAgentLensTestingRun(event.params.runId);
    return json(
      {
        success: true,
        run
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return json(
      {
        success: false,
        error_code: 'AGENTLENS_TESTING_RUN_NOT_FOUND',
        error_message: error instanceof Error ? error.message : 'Failed to load AgentLens testing run.'
      },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }
}
