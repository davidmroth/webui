import { json } from '@sveltejs/kit';
import { enqueueUserMessage, isConversationBusy, listMessages } from '$server/chat';
import { requireSession } from '$server/auth';

function isRequestBodyTooLarge(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return (
    normalized.includes('content-length') && normalized.includes('exceeds limit')
  ) || normalized.includes('request body size exceeded');
}

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
    const objectError =
      error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
    const messageFromObject =
      objectError && typeof objectError.message === 'string' && objectError.message.trim()
        ? objectError.message.trim()
        : null;
    const codeFromObject =
      objectError && typeof objectError.code === 'string' && objectError.code.trim()
        ? objectError.code.trim()
        : null;

    const reason =
      error instanceof Error && error.message
        ? error.message
        : messageFromObject || codeFromObject || 'Unknown upload error';

    console.error('Failed to process message upload', {
      conversationId: event.params.conversationId,
      userId: session.userId,
      reason
    });

    if (isRequestBodyTooLarge(reason)) {
      return json(
        {
          error:
            'Upload is too large for this server. Reduce attachment size or increase BODY_SIZE_LIMIT.'
        },
        { status: 413 }
      );
    }

    return json(
      {
        error: `Unable to process message upload: ${reason}`
      },
      { status: 500 }
    );
  }
}
