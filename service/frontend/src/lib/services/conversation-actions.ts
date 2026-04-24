import { MimeTypeText } from '$lib/enums';
import type { ConversationSummary } from '$lib/types-legacy';
import { downloadResourceContent } from '$lib/utils/mcp';

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null);
  return payload && typeof payload.error === 'string' && payload.error.trim()
    ? payload.error.trim()
    : fallback;
}

function sanitizeConversationFilenameSegment(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return (normalized || 'conversation').slice(0, 48);
}

export function buildConversationExportFilename(
  conversation: Pick<ConversationSummary, 'id' | 'title'>
): string {
  return `hermes-conversation-${sanitizeConversationFilenameSegment(conversation.title)}-${conversation.id.slice(0, 8)}.json`;
}

export async function renameConversation(conversationId: string, title: string): Promise<void> {
  const response = await fetch(`/api/conversations/${conversationId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title })
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Unable to rename conversation.'));
  }
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const response = await fetch(`/api/conversations/${conversationId}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Unable to delete conversation.'));
  }
}

export async function exportConversation(
  conversation: Pick<ConversationSummary, 'id' | 'title'>
): Promise<void> {
  const response = await fetch(`/api/conversations/${conversation.id}`);

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Unable to export conversation.'));
  }

  const payload = await response.json();
  downloadResourceContent(
    JSON.stringify(payload, null, 2),
    MimeTypeText.JSON,
    buildConversationExportFilename(conversation)
  );
}