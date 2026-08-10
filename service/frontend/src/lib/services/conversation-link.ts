import type { ConversationSummary } from '../types-legacy';

export function buildConversationUrl(conversationId: string): string {
	const path = `/chat?conversation=${encodeURIComponent(conversationId)}`;
	if (typeof window === 'undefined') {
		return path;
	}
	return `${window.location.origin}${path}`;
}

export async function copyConversationLink(
	conversation: Pick<ConversationSummary, 'id'>
): Promise<boolean> {
	const { copyToClipboard } = await import('../utils/clipboard');
	return copyToClipboard(
		buildConversationUrl(conversation.id),
		'Chat link copied to clipboard',
		'Failed to copy chat link'
	);
}
