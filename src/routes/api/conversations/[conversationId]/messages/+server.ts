import { json } from '@sveltejs/kit';
import { enqueueUserMessage, isConversationBusy, listMessages } from '$server/chat';
import { requireSession } from '$server/auth';

export async function GET(event) {
  const session = await requireSession(event);
  const [messages, assistantBusy] = await Promise.all([
    listMessages(session.userId, event.params.conversationId),
    isConversationBusy(session.userId, event.params.conversationId)
  ]);
  return json({ messages, assistantBusy });
}

export async function POST(event) {
  const session = await requireSession(event);
  try {
    const contentType = event.request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await event.request.formData();
      const content = String(formData.get('content') || '').trim();
      const files = formData
        .getAll('attachments')
        .filter((value): value is File => value instanceof File && value.size > 0);
      if (!content && files.length === 0) {
        return json({ error: 'Message content or at least one attachment is required.' }, { status: 400 });
      }

      const result = await enqueueUserMessage(session.userId, event.params.conversationId, content, files);
      return json(result, { status: 201 });
    }

    const body = await event.request.json().catch(() => ({}));
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) {
      return json({ error: 'Message content is required.' }, { status: 400 });
    }

    const result = await enqueueUserMessage(session.userId, event.params.conversationId, content);
    return json(result, { status: 201 });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error && error.message
            ? `Unable to process message upload: ${error.message}`
            : 'Unable to process message upload.'
      },
      { status: 500 }
    );
  }
}
