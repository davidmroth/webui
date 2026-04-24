import type { ChatMessage, ConversationSummary } from '../types-legacy';

function isPendingMessage(message: ChatMessage) {
  return message.id.startsWith('pending-');
}

function isCompletedAssistantMessage(message: ChatMessage) {
  return message.role === 'assistant' && message.status === 'complete' && !isPendingMessage(message);
}

function isTerminalAssistantMessage(message: ChatMessage) {
  return (
    message.role === 'assistant' &&
    (message.status === 'complete' || message.status === 'error') &&
    !isPendingMessage(message)
  );
}

export function rememberSeenAssistantMessages(
  seenAssistantMessageIds: Set<string>,
  nextMessages: ChatMessage[]
) {
  const nextSeen = new Set(seenAssistantMessageIds);
  for (const message of nextMessages) {
    if (isCompletedAssistantMessage(message)) {
      nextSeen.add(message.id);
    }
  }
  return nextSeen;
}

export function getLatestUnseenAssistantReply(
  seenAssistantMessageIds: Set<string>,
  nextMessages: ChatMessage[]
) {
  for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
    const message = nextMessages[index];
    if (isCompletedAssistantMessage(message) && !seenAssistantMessageIds.has(message.id)) {
      return message;
    }
  }

  return null;
}

export function getLatestTerminalAssistantMessageId(nextMessages: ChatMessage[]): string | null {
  for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
    const message = nextMessages[index];
    if (isTerminalAssistantMessage(message)) {
      return message.id;
    }
  }

  return null;
}

export function indexConversationUpdatedAt(nextConversations: ConversationSummary[]) {
  return Object.fromEntries(nextConversations.map((conversation) => [conversation.id, conversation.updatedAt]));
}

export function indexConversationAssistantBusy(nextConversations: ConversationSummary[]) {
  return Object.fromEntries(
    nextConversations.map((conversation) => [conversation.id, Boolean(conversation.assistantBusy)])
  );
}

export function shouldNotifyAssistantReply(options: {
  notificationsEnabled: boolean;
  notificationPermission: NotificationPermission;
  conversationId: string;
  currentConversationId: string | null;
  documentVisibility: DocumentVisibilityState;
  documentHasFocus: boolean;
}) {
  if (!options.notificationsEnabled || options.notificationPermission !== 'granted') {
    return false;
  }

  return (
    options.documentVisibility !== 'visible' ||
    !options.documentHasFocus ||
    options.conversationId !== options.currentConversationId
  );
}

export function getChangedConversationIdsForReplyChecks(options: {
  currentConversationId: string | null;
  nextConversations: ConversationSummary[];
  previousUpdatedAtById: Record<string, string>;
  previousBusyById: Record<string, boolean>;
}) {
  return options.nextConversations
    .filter((conversation) => {
      if (conversation.id === options.currentConversationId) {
        return false;
      }

      const previousUpdatedAt = options.previousUpdatedAtById[conversation.id];
      const updatedAtChanged = Boolean(previousUpdatedAt && previousUpdatedAt !== conversation.updatedAt);

      const wasBusy = options.previousBusyById[conversation.id] === true;
      const isBusy = Boolean(conversation.assistantBusy);
      const becameIdle = wasBusy && !isBusy;

      return updatedAtChanged || becameIdle;
    })
    .map((conversation) => conversation.id);
}