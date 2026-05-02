import { json } from '@sveltejs/kit';
import { ensureBootstrapUser } from '$server/auth';
import {
  createConversation,
  enqueueUserMessage,
  getConversationOwnerId,
  getConversationRunState,
  getHermesQueueStats,
  listMessages
} from '$server/chat';
import {
  findProbeResponseMessages,
  normalizeChatProbeOptions,
  waitForProbeResponses
} from '$server/diagnostics-chat-probe';
import { requireDiagnosticsToken } from '$server/diagnostics-auth';
import {
  DiagnosticEventType,
  DiagnosticHop,
  emitDiagnosticEvent,
  getDiagnosticEvents
} from '$server/diagnostics';
import { getHermesWorkerHeartbeat } from '$server/hermes-heartbeat';

function getRequestId(request: Request) {
  return request.headers.get('x-request-id')?.trim() || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseLimit(url: URL) {
  const limit = Number(url.searchParams.get('limit') ?? 100);
  return Number.isFinite(limit) ? Math.min(200, Math.max(1, Math.floor(limit))) : 100;
}

async function loadProbeConversation(conversationId: string) {
  const ownerId = await getConversationOwnerId(conversationId);
  if (!ownerId) {
    return null;
  }

  const [messages, runState, queue, worker] = await Promise.all([
    listMessages(ownerId, conversationId),
    getConversationRunState(ownerId, conversationId),
    getHermesQueueStats().catch((error) => ({
      error: error instanceof Error ? error.message : 'Queue query failed.'
    })),
    Promise.resolve(getHermesWorkerHeartbeat())
  ]);

  return { ownerId, messages, runState, queue, worker };
}

export async function GET({ request, url }) {
  const denied = requireDiagnosticsToken(request);
  if (denied) {
    return denied;
  }

  const conversationId = url.searchParams.get('conversation_id')?.trim() || url.searchParams.get('conversationId')?.trim();
  if (!conversationId) {
    return json(
      {
        success: false,
        error_code: 'DIAGNOSTIC_CHAT_PROBE_CONVERSATION_REQUIRED',
        error_message: 'conversation_id is required.'
      },
      { status: 400 }
    );
  }

  const loaded = await loadProbeConversation(conversationId);
  if (!loaded) {
    return json(
      {
        success: false,
        error_code: 'DIAGNOSTIC_CHAT_PROBE_CONVERSATION_NOT_FOUND',
        error_message: 'Conversation not found.'
      },
      { status: 404 }
    );
  }

  return json({
    success: true,
    conversationId,
    messages: loaded.messages,
    diagnostics: getDiagnosticEvents({ conversationId, limit: parseLimit(url) }),
    queue: loaded.queue,
    worker: loaded.worker
  });
}

export async function POST({ request }) {
  const denied = requireDiagnosticsToken(request);
  if (denied) {
    return denied;
  }

  const requestId = getRequestId(request);
  let options;
  try {
    options = normalizeChatProbeOptions(await request.json().catch(() => ({})));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Invalid probe request.';
    return json(
      {
        success: false,
        error_code: 'DIAGNOSTIC_CHAT_PROBE_INVALID_REQUEST',
        error_message: errorMessage,
        request_id: requestId
      },
      { status: 400 }
    );
  }

  let conversationId = options.conversationId;
  let ownerId: string | null;

  if (conversationId) {
    ownerId = await getConversationOwnerId(conversationId);
    if (!ownerId) {
      return json(
        {
          success: false,
          error_code: 'DIAGNOSTIC_CHAT_PROBE_CONVERSATION_NOT_FOUND',
          error_message: 'Conversation not found.',
          request_id: requestId
        },
        { status: 404 }
      );
    }
  } else {
    ownerId = await ensureBootstrapUser();
    conversationId = await createConversation(ownerId, options.title);
  }

  if (!ownerId || !conversationId) {
    return json(
      {
        success: false,
        error_code: 'DIAGNOSTIC_CHAT_PROBE_INVALID_STATE',
        error_message: 'Unable to resolve a diagnostics probe owner or conversation.',
        request_id: requestId
      },
      { status: 500 }
    );
  }

  const probeOwnerId: string = ownerId;
  const probeConversationId: string = conversationId;

  emitDiagnosticEvent(
    DiagnosticEventType.DiagnosticChatProbeRequested,
    DiagnosticHop.WebuiApi,
    {
      conversationId: probeConversationId,
      requestId,
      contentLength: options.content.length,
      waitForResponse: options.waitForResponse,
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs
    },
    probeConversationId
  );

  try {
    const queued = await enqueueUserMessage(probeOwnerId, probeConversationId, options.content);
    emitDiagnosticEvent(
      DiagnosticEventType.DiagnosticChatProbeQueued,
      DiagnosticHop.WebuiApi,
      {
        conversationId: probeConversationId,
        requestId,
        messageId: queued.messageId,
        eventId: queued.eventId,
        waitForResponse: options.waitForResponse
      },
      probeConversationId
    );

    const loadMessages = () => listMessages(probeOwnerId, probeConversationId);
    if (!options.waitForResponse) {
      const messages = await loadMessages();
      return json(
        {
          success: true,
          status: 'queued',
          request_id: requestId,
          conversationId: probeConversationId,
          queued,
          messages,
          responseMessages: findProbeResponseMessages(messages, queued.messageId),
          diagnostics: getDiagnosticEvents({ conversationId: probeConversationId, requestId, limit: 50 })
        },
        { status: 202 }
      );
    }

    const waitResult = await waitForProbeResponses({
      loadMessages,
      userMessageId: queued.messageId,
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs
    });

    if (waitResult.status === 'completed') {
      emitDiagnosticEvent(
        DiagnosticEventType.DiagnosticChatProbeCompleted,
        DiagnosticHop.WebuiApi,
        {
          conversationId: probeConversationId,
          requestId,
          messageId: queued.messageId,
          eventId: queued.eventId,
          responseMessageIds: waitResult.responseMessages.map((message) => message.id),
          elapsedMs: waitResult.elapsedMs
        },
        probeConversationId
      );
    } else {
      emitDiagnosticEvent(
        DiagnosticEventType.DiagnosticChatProbeFailed,
        DiagnosticHop.WebuiApi,
        {
          conversationId: probeConversationId,
          requestId,
          messageId: queued.messageId,
          eventId: queued.eventId,
          errorCode: 'DIAGNOSTIC_CHAT_PROBE_TIMEOUT',
          errorMessage: 'Timed out waiting for an assistant or system response.',
          timeoutMs: options.timeoutMs,
          elapsedMs: waitResult.elapsedMs
        },
        probeConversationId
      );
    }

    const [queue, worker] = await Promise.all([
      getHermesQueueStats().catch((error) => ({
        error: error instanceof Error ? error.message : 'Queue query failed.'
      })),
      Promise.resolve(getHermesWorkerHeartbeat())
    ]);

    return json(
      {
        success: waitResult.status === 'completed',
        status: waitResult.status,
        request_id: requestId,
        conversationId: probeConversationId,
        queued,
        elapsedMs: waitResult.elapsedMs,
        messages: waitResult.messages,
        responseMessages: waitResult.responseMessages,
        diagnostics: getDiagnosticEvents({ conversationId: probeConversationId, limit: 100 }),
        queue,
        worker,
        ...(waitResult.status === 'timed_out'
          ? {
              error_code: 'DIAGNOSTIC_CHAT_PROBE_TIMEOUT',
              error_message: 'Timed out waiting for an assistant or system response.'
            }
          : {})
      },
      { status: waitResult.status === 'completed' ? 200 : 504 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Chat probe failed.';
    emitDiagnosticEvent(
      DiagnosticEventType.DiagnosticChatProbeFailed,
      DiagnosticHop.WebuiApi,
      {
        conversationId: probeConversationId,
        requestId,
        errorClass: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage
      },
      probeConversationId
    );
    return json(
      {
        success: false,
        error_code: 'DIAGNOSTIC_CHAT_PROBE_FAILED',
        error_message: errorMessage,
        request_id: requestId,
        conversationId: probeConversationId,
        diagnostics: getDiagnosticEvents({ conversationId: probeConversationId, limit: 100 })
      },
      { status: 500 }
    );
  }
}
