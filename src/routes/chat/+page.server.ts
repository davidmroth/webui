import { fail, redirect } from '@sveltejs/kit';
import {
  createConversation,
  enqueueUserMessage,
  isConversationBusy,
  listConversations,
  listMessages
} from '$server/chat';
import { getBuildInfo } from '$server/maintenance';
import { requireSession } from '$server/auth';

export async function load(event) {
  const session = await requireSession(event);
  const [conversations, buildInfo] = await Promise.all([
    listConversations(session.userId),
    getBuildInfo()
  ]);
  const requestedConversation = event.url.searchParams.get('conversation');
  const currentConversationId = requestedConversation || conversations[0]?.id || null;
  const [messages, assistantBusy] = currentConversationId
    ? await Promise.all([
        listMessages(session.userId, currentConversationId),
        isConversationBusy(session.userId, currentConversationId)
      ])
    : [[], false];

  return {
    session,
    conversations,
    currentConversationId,
    messages,
    assistantBusy,
    buildInfo
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
    const files = formData
      .getAll('attachments')
      .filter((value): value is File => value instanceof File && value.size > 0);
    if (!content && files.length === 0) {
      return fail(400, { error: 'Message content or at least one attachment is required.' });
    }

    let conversationId = String(formData.get('conversationId') || '').trim();
    if (!conversationId) {
      const title = content.slice(0, 48);
      conversationId = await createConversation(session.userId, title || 'New conversation');
    }

    await enqueueUserMessage(session.userId, conversationId, content, files);
    throw redirect(303, `/chat?conversation=${conversationId}`);
  }
};
