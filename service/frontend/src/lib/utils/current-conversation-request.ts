export function isCurrentConversationRequest(
  requestedConversationId: string | null,
  currentConversationId: string | null
): boolean {
  return Boolean(requestedConversationId) && requestedConversationId === currentConversationId;
}