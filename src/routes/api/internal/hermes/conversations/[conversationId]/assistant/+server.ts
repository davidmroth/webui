import { json } from '@sveltejs/kit';
import { storeAssistantMessage, storeAssistantMessageWithAttachments } from '$server/chat';
import { getConfig } from '$server/env';

interface AssistantJsonAttachment {
  fileName?: unknown;
  contentType?: unknown;
  text?: unknown;
  base64Data?: unknown;
}

interface AttachmentUpload {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function isAuthorized(request: Request) {
  const expected = getConfig().hermesServiceToken;
  const authHeader = request.headers.get('authorization') || '';
  return authHeader === `Bearer ${expected}`;
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return Uint8Array.from(buffer).buffer;
}

function createAttachmentUpload(
  fileName: string,
  contentType: string,
  buffer: Buffer
): AttachmentUpload {
  return {
    name: fileName,
    type: contentType,
    size: buffer.byteLength,
    async arrayBuffer() {
      return bufferToArrayBuffer(buffer);
    }
  };
}

function parseJsonAttachments(rawAttachments: unknown): AttachmentUpload[] {
  if (rawAttachments == null) {
    return [];
  }

  if (!Array.isArray(rawAttachments)) {
    throw new Error('attachments must be an array.');
  }

  return rawAttachments.map((rawAttachment, index) => {
    if (!rawAttachment || typeof rawAttachment !== 'object') {
      throw new Error(`attachments[${index}] must be an object.`);
    }

    const attachment = rawAttachment as AssistantJsonAttachment;
    const fileName =
      typeof attachment.fileName === 'string' && attachment.fileName.trim()
        ? attachment.fileName.trim()
        : `attachment-${index + 1}`;

    if (typeof attachment.text === 'string') {
      const contentType =
        typeof attachment.contentType === 'string' && attachment.contentType.trim()
          ? attachment.contentType.trim()
          : 'text/plain; charset=utf-8';
      const buffer = Buffer.from(attachment.text, 'utf8');
      if (buffer.byteLength === 0) {
        throw new Error(`attachments[${index}] text must not be empty.`);
      }

      return createAttachmentUpload(fileName, contentType, buffer);
    }

    if (typeof attachment.base64Data === 'string') {
      const normalizedBase64 = attachment.base64Data.trim();
      if (!normalizedBase64) {
        throw new Error(`attachments[${index}] base64Data must not be empty.`);
      }

      const buffer = Buffer.from(normalizedBase64, 'base64');
      if (buffer.byteLength === 0) {
        throw new Error(`attachments[${index}] base64Data could not be decoded.`);
      }

      const contentType =
        typeof attachment.contentType === 'string' && attachment.contentType.trim()
          ? attachment.contentType.trim()
          : 'application/octet-stream';

      return createAttachmentUpload(fileName, contentType, buffer);
    }

    throw new Error(
      `attachments[${index}] must include either text or base64Data.`
    );
  });
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

  let attachments: AttachmentUpload[] = [];
  try {
    attachments = parseJsonAttachments(body.attachments);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Invalid assistant attachments.' },
      { status: 400 }
    );
  }

  if (!content && attachments.length === 0) {
    return json({ error: 'Assistant content or attachment is required.' }, { status: 400 });
  }

  const messageId = attachments.length
    ? await storeAssistantMessageWithAttachments(params.conversationId, content, attachments)
    : await storeAssistantMessage(params.conversationId, content);

  return json({ ok: true, messageId }, { status: 201 });
}
