import { json } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import { getConfig } from '$server/env';
import {
  getLatestAgentLensTestingRunForConversation,
  isAgentLensTestingError
} from '$server/agentlens-testing';

const NO_STORE_HEADERS = {
  'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  pragma: 'no-cache',
  expires: '0'
};

export async function GET(event) {
  await requireSession(event);
  if (!getConfig().agentlensTestingEnabled) {
    return json(
      {
        success: true,
        run: null,
        disabled: true
      },
      { headers: NO_STORE_HEADERS }
    );
  }
  const conversationId = event.url.searchParams.get('conversation_id')?.trim() ?? '';

  if (!conversationId) {
    return json(
      {
        success: false,
        error_code: 'AGENTLENS_TESTING_INVALID_INPUT',
        error_message: 'conversation_id is required.'
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const run = await getLatestAgentLensTestingRunForConversation(conversationId);
    return json(
      {
        success: true,
        conversation_id: conversationId,
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
        error_code: 'AGENTLENS_TESTING_LOOKUP_FAILED',
        error_message: error instanceof Error ? error.message : 'Failed to load AgentLens testing progress.'
      },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}