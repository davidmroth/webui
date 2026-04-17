import { fail, redirect } from '@sveltejs/kit';
import { createConversation, enqueueUserMessage, listConversations, listMessages } from '$server/chat';
import { requireSession } from '$server/auth';

export async function load(event) {
  const session = await requireSession(event);
  const conversations = await listConversations(session.userId);
  const requestedConversation = event.url.searchParams.get('conversation');
  const currentConversationId = requestedConversation || conversations[0]?.id || null;
  const messages = currentConversationId ? await listMessages(session.userId, currentConversationId) : [];

  return {
    session,
    conversations,
    currentConversationId,
    messages
  };
}

export const actions = {
  createConversation: async (event) => {
    const session = await requireSession(event);
    const formData = await event.request.formData();
    const title = String(formData.get('title') || '').trim() || 'New conversation';
    const conversationId = await createConversation(session.userId, title);
    throw redirect(303, `/chat?conversation=${conversationId}`);
  },
  sendMessage: async (event) => {
    const session = await requireSession(event);
    const formData = await event.request.formData();
    const content = String(formData.get('content') || '').trim();
    if (!content) {
      return fail(400, { error: 'Message content is required.' });
    }

    let conversationId = String(formData.get('conversationId') || '').trim();
    if (!conversationId) {
      const title = content.slice(0, 48);
      conversationId = await createConversation(session.userId, title || 'New conversation');
    }

    await enqueueUserMessage(session.userId, conversationId, content);
    throw redirect(303, `/chat?conversation=${conversationId}`);
  }
};
