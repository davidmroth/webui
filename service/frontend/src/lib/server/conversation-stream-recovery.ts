export type AssistantCatchupStatus = 'complete' | 'error';

type LatestAssistantMessage = {
  id: string;
  status: 'complete' | 'streaming' | 'error';
} | null;

export function resolveConversationStreamCursor(options: {
  lastEventId: string | null;
  lastAssistantMessageId: string | null;
}): string | null {
  const lastEventId = options.lastEventId?.trim();
  if (lastEventId) {
    return lastEventId;
  }

  const lastAssistantMessageId = options.lastAssistantMessageId?.trim();
  return lastAssistantMessageId || null;
}

export function getAssistantCatchupDoneEvent(
  latestAssistantMessage: LatestAssistantMessage,
  lastDeliveredAssistantMessageId: string | null
): { messageId: string; status: AssistantCatchupStatus } | null {
  if (!latestAssistantMessage || latestAssistantMessage.status === 'streaming') {
    return null;
  }

  if (latestAssistantMessage.id === lastDeliveredAssistantMessageId) {
    return null;
  }

  return {
    messageId: latestAssistantMessage.id,
    status: latestAssistantMessage.status === 'error' ? 'error' : 'complete'
  };
}