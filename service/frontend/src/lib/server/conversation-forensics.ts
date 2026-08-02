import {
  getConversationOwnerId,
  getConversationRunState,
  getHermesQueueStats,
  listHermesDeliveryTracesForConversation,
  listHermesEventsForConversation,
  listMessages
} from './chat';
import { getDiagnosticEvents } from './diagnostics';
import { getHermesWorkerHeartbeat } from './hermes-heartbeat';
import { query } from './db';

export type ForensicsLayer = 'hermes_sender' | 'webui_receiver' | 'idle' | 'unknown';

export interface ForensicsVerdict {
  code: string;
  summary: string;
  likelyLayer: ForensicsLayer;
  hints: string[];
}

export interface ForensicsMessageTail {
  id: string;
  role: string;
  displayType: string | null;
  createdAt: string | null;
  contentSnippet: string;
  contentLength: number;
  hasTimings: boolean;
}

interface ForensicsAnalyzeInput {
  currNode: string | null;
  messages: Awaited<ReturnType<typeof listMessages>>;
  runState: Awaited<ReturnType<typeof getConversationRunState>>;
  lastEvent: Awaited<ReturnType<typeof listHermesEventsForConversation>>[number] | null;
  deliveryTraces: Awaited<ReturnType<typeof listHermesDeliveryTracesForConversation>>;
  diagnosticFailures: number;
}

const PREAMBLE_PATTERN =
  /^(let me|now let me|right,? let me|good[\s—-]|sure[\s—-]|here'?s what|i(?:'ll| will) check)/i;

function asDisplayType(message: { displayType?: string | null }) {
  return typeof message.displayType === 'string' && message.displayType.trim()
    ? message.displayType.trim()
    : null;
}

export function looksIncompleteAssistantReply(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return true;
  }

  if (trimmed.length < 320 && PREAMBLE_PATTERN.test(trimmed)) {
    return true;
  }

  if (trimmed.length < 220 && !/[.!?]["')\]]*$/.test(trimmed)) {
    return true;
  }

  return false;
}

export function buildForensicsMessageTail(
  messages: ForensicsAnalyzeInput['messages'],
  limit = 8
): ForensicsMessageTail[] {
  return messages.slice(-limit).map((message) => ({
    id: message.id,
    role: message.role,
    displayType: asDisplayType(message),
    createdAt: message.createdAt ?? null,
    contentSnippet: (message.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
    contentLength: (message.content ?? '').length,
    hasTimings: Boolean(message.timings)
  }));
}

export function deriveConversationForensicsVerdict(input: ForensicsAnalyzeInput): ForensicsVerdict {
  const hints: string[] = [];
  const tail = input.messages.at(-1) ?? null;
  const previous = input.messages.at(-2) ?? null;
  const rejectedTrace = input.deliveryTraces.find((trace) => trace.receiverStatus === 'rejected');

  if (rejectedTrace) {
    return {
      code: 'receiver_rejected_delivery',
      likelyLayer: 'webui_receiver',
      summary: 'WebUI rejected at least one Hermes assistant delivery for this conversation.',
      hints: [
        `Latest rejection: ${rejectedTrace.errorText ?? 'no error text recorded'}`,
        'Check diagnostics events for HERMES_ASSISTANT_POST_REJECTED or HERMES_ASSISTANT_POST_FAILED.'
      ]
    };
  }

  if (input.runState.active) {
    return {
      code: 'run_in_flight',
      likelyLayer: 'hermes_sender',
      summary: 'Hermes still has an active queued or processing run for this conversation.',
      hints: [
        `Run status: ${input.runState.status}`,
        input.runState.eventId ? `Event id: ${input.runState.eventId}` : 'No event id on run state.'
      ]
    };
  }

  if (input.runState.status === 'stale') {
    return {
      code: 'run_stale',
      likelyLayer: 'hermes_sender',
      summary: input.runState.errorMessage ?? 'No progress from Hermes within the event lease window.',
      hints: [
        input.runState.errorCode ? `Error code: ${input.runState.errorCode}` : 'No run error code recorded.',
        'The webui receiver marked the inbox event stale; inspect Hermes gateway logs for the sender-side failure.'
      ]
    };
  }

  if (input.runState.status === 'failed') {
    return {
      code: 'run_failed',
      likelyLayer: 'hermes_sender',
      summary: input.runState.errorMessage ?? 'Hermes reported a failed run for this conversation.',
      hints: [input.runState.errorCode ? `Error code: ${input.runState.errorCode}` : 'No run error code recorded.']
    };
  }

  if (tail?.role === 'user') {
    return {
      code: 'awaiting_assistant',
      likelyLayer: 'hermes_sender',
      summary: 'The visible branch ends on a user message with no assistant reply.',
      hints: [
        input.lastEvent
          ? `Latest inbox event is ${input.lastEvent.status}/${input.lastEvent.runStatus}.`
          : 'No inbox events were found for this conversation.'
      ]
    };
  }

  if (tail && asDisplayType(tail) === 'tool_progress') {
    return {
      code: 'awaiting_assistant_after_tool',
      likelyLayer: 'hermes_sender',
      summary: 'The visible branch ends right after tool progress with no following assistant answer.',
      hints: [
        'This usually means Hermes posted tool activity but never finished the turn on the sender side.',
        'Check Hermes gateway logs around the last tool_progress timestamp.'
      ]
    };
  }

  if (tail?.role === 'assistant' && looksIncompleteAssistantReply(tail.content ?? '')) {
    const eventCompleted =
      input.lastEvent &&
      (input.lastEvent.runStatus === 'completed' ||
        input.lastEvent.runStatus === 'stale' ||
        input.lastEvent.status === 'acked');

    if (eventCompleted) {
      hints.push(
        `Latest inbox event ${input.lastEvent?.id ?? 'unknown'} is ${input.lastEvent?.status}/${input.lastEvent?.runStatus}.`
      );
      hints.push(
        'Delivery traces show WebUI accepted the partial assistant posts; the failure is likely Hermes ending the turn early.'
      );
      if (input.diagnosticFailures > 0) {
        hints.push(`${input.diagnosticFailures} recent in-memory diagnostics failure(s) were recorded for this conversation.`);
      }
      return {
        code: 'likely_premature_complete',
        likelyLayer: 'hermes_sender',
        summary:
          'Hermes marked the turn complete, but the visible assistant reply still looks like an unfinished preamble or truncated answer.',
        hints
      };
    }
  }

  if (previous?.role === 'user' && tail?.role === 'assistant' && looksIncompleteAssistantReply(tail.content ?? '')) {
    return {
      code: 'assistant_tail_incomplete',
      likelyLayer: 'hermes_sender',
      summary: 'The latest assistant message on the visible branch looks incomplete even though the inbox run is idle.',
      hints: [
        'Compare the message tail below with Hermes gateway logs for the same timestamps.',
        'If delivery traces are accepted, focus on the sender-side agent loop rather than WebUI receive paths.'
      ]
    };
  }

  if (input.diagnosticFailures > 0) {
    hints.push(`${input.diagnosticFailures} recent in-memory diagnostics failure(s) were recorded for this conversation.`);
  }

  return {
    code: 'no_obvious_fault',
    likelyLayer: 'unknown',
    summary: 'No stale queue work or obvious receiver-side rejection was detected for this conversation.',
    hints:
      hints.length > 0
        ? hints
        : [
            'If the chat still looks wrong, compare the message tail and Hermes event history timestamps with gateway logs.',
            input.currNode ? `Current curr node: ${input.currNode}` : 'No curr node recorded.'
          ]
  };
}

export async function collectConversationForensics(conversationId: string, options: { eventLimit?: number } = {}) {
  const ownerId = await getConversationOwnerId(conversationId);
  if (!ownerId) {
    return null;
  }

  const eventLimit = Math.max(1, Math.min(options.eventLimit ?? 20, 50));
  const diagnosticLimit = Math.max(1, Math.min(eventLimit * 2, 100));

  const [conversationRows, messages, runState, queue, worker, hermesEvents, deliveryTraces, diagnosticsEvents] =
    await Promise.all([
      query<{ id: string; title: string | null; curr_node: string | null; updated_at: Date | string | null }>(
        `SELECT id, title, curr_node, updated_at
         FROM conversations
         WHERE id = :conversation_id
           AND user_id = :user_id
         LIMIT 1`,
        { conversation_id: conversationId, user_id: ownerId }
      ),
      listMessages(ownerId, conversationId),
      getConversationRunState(ownerId, conversationId),
      getHermesQueueStats().catch((error) => ({
        error: error instanceof Error ? error.message : 'Queue query failed.'
      })),
      Promise.resolve(getHermesWorkerHeartbeat()),
      listHermesEventsForConversation(conversationId, eventLimit),
      listHermesDeliveryTracesForConversation(conversationId, eventLimit),
      Promise.resolve(getDiagnosticEvents({ conversationId, limit: diagnosticLimit }))
    ]);

  const conversation = conversationRows[0] ?? null;
  const diagnosticFailures = diagnosticsEvents.filter((event) =>
    event.eventType.endsWith('_FAILED') || event.eventType.endsWith('_REJECTED')
  ).length;

  const verdict = deriveConversationForensicsVerdict({
    currNode: conversation?.curr_node ?? null,
    messages,
    runState,
    lastEvent: hermesEvents[0] ?? null,
    deliveryTraces,
    diagnosticFailures
  });

  return {
    collectedAt: new Date().toISOString(),
    conversationId,
    conversation: conversation
      ? {
          id: conversation.id,
          title: conversation.title,
          currNode: conversation.curr_node,
          updatedAt:
            conversation.updated_at instanceof Date
              ? conversation.updated_at.toISOString()
              : String(conversation.updated_at ?? '')
        }
      : null,
    verdict,
    runState,
    queue,
    worker,
    messageTail: buildForensicsMessageTail(messages),
    hermesEvents,
    deliveryTraces,
    diagnosticsEvents,
    queries: {
      diagnosticsEvents: `/api/internal/diagnostics/events?conversation_id=${encodeURIComponent(conversationId)}`,
      chatProbe: `/api/internal/diagnostics/chat-probe?conversation_id=${encodeURIComponent(conversationId)}`,
      maintenanceForensics: `/maintenance/conversations/${encodeURIComponent(conversationId)}/forensics`
    }
  };
}

export function parseConversationIdFromInput(raw: string) {
  const value = raw.trim();
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const fromQuery = url.searchParams.get('conversation')?.trim();
    if (fromQuery) {
      return fromQuery;
    }
    const match = url.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Not a URL — fall through to raw UUID handling.
  }

  return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}
