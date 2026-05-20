import { json } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import { enqueueUserMessage, getConversationRunState, isConversationBusy, listMessages } from '$server/chat';
import { requireSession } from '$server/auth';

export function buildEtag(value: unknown): string {
  const digest = createHash('sha1').update(JSON.stringify(value)).digest('hex');
  return `"${digest}"`;
}

export function requestHasMatchingEtag(request: Request, etag: string): boolean {
  const header = request.headers.get('if-none-match');
  if (!header) {
    return false;
  }

  if (header.trim() === '*') {
    return true;
  }

  return header
    .split(',')
    .map((candidate) => candidate.trim())
    .includes(etag);
}

function isRequestBodyTooLarge(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return (
    normalized.includes('content-length') && normalized.includes('exceeds limit')
  ) || normalized.includes('request body size exceeded');
}

export async function GET(event) {
  const session = await requireSession(event);
  const [messages, assistantBusy, runState] = await Promise.all([
    listMessages(session.userId, event.params.conversationId),
    isConversationBusy(session.userId, event.params.conversationId),
    getConversationRunState(session.userId, event.params.conversationId)
  ]);
  const body = { messages, assistantBusy, runState };
  const etag = buildEtag(body);

  if (requestHasMatchingEtag(event.request, etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        etag,
        'cache-control': 'private, max-age=0, must-revalidate'
      }
    });
  }

  return json(body, {
    headers: {
      etag,
      'cache-control': 'private, max-age=0, must-revalidate'
    }
  });
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
