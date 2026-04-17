import { json } from '@sveltejs/kit';
import { storeAssistantMessage, storeAssistantMessageWithAttachments } from '$server/chat';
import { getConfig } from '$server/env';

function isAuthorized(request: Request) {
  const expected = getConfig().hermesServiceToken;
  const authHeader = request.headers.get('authorization') || '';
  return authHeader === `Bearer ${expected}`;
}

export async function POST({ params, request }) {
  if (!isAuthorized(request)) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const content = String(formData.get('content') || '').trim();
    const files = formData
      .getAll('attachments')
      .filter((value): value is File => value instanceof File && value.size > 0);
    if (!content && files.length === 0) {
      return json({ error: 'Assistant content or attachment is required.' }, { status: 400 });
    }

    const messageId = await storeAssistantMessageWithAttachments(params.conversationId, content, files);
    return json({ ok: true, messageId }, { status: 201 });
  }

  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) {
    return json({ error: 'Assistant content is required.' }, { status: 400 });
  }

  const messageId = await storeAssistantMessage(params.conversationId, content);
  return json({ ok: true, messageId }, { status: 201 });
}
