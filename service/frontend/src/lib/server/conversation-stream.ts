export type ConversationStreamEvent =
  | {
      type: 'typing';
      conversationId: string;
    }
  | {
      type: 'typing-stop';
      conversationId: string;
    }
  | {
      type: 'message';
      conversationId: string;
      messageId: string;
    }
  | {
      type: 'delta';
      conversationId: string;
      messageId: string;
      seq: number;
      delta: string;
    }
  | {
      type: 'done';
      conversationId: string;
      messageId: string;
      status: 'complete' | 'streaming' | 'error';
    };

type ConversationStreamListener = (event: ConversationStreamEvent) => void;

const listenersByConversation = new Map<string, Set<ConversationStreamListener>>();

export function publishConversationStreamEvent(event: ConversationStreamEvent) {
  const listeners = listenersByConversation.get(event.conversationId);
  if (!listeners || listeners.size === 0) {
    return;
  }

  for (const listener of Array.from(listeners)) {
    listener(event);
  }
}

export function subscribeConversationStream(
  conversationId: string,
  listener: ConversationStreamListener
) {
  let listeners = listenersByConversation.get(conversationId);
  if (!listeners) {
    listeners = new Set<ConversationStreamListener>();
    listenersByConversation.set(conversationId, listeners);
  }

  listeners.add(listener);

  return () => {
    const currentListeners = listenersByConversation.get(conversationId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      listenersByConversation.delete(conversationId);
    }
  };
}