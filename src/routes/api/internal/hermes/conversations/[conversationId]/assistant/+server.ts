import { json } from '@sveltejs/kit';
import {
  storeAssistantMessage,
  storeAssistantMessageWithAttachments,
  openStreamingAssistantMessage,
  appendAssistantChunk,
  finalizeStreamingAssistantMessage
} from '$server/chat';
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

/**
 * Coerce a raw `body.timings` value into a plain object suitable for
 * persisting in `messages.timings`. Returns `undefined` when the input is
 * absent / wrong-shaped so callers can skip the option entirely (the storage
 * helper treats absent timings as NULL).
 */
function normalizeTimingsInput(raw: unknown): Record<string, unknown> | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  if (Object.keys(obj).length === 0) {
    return undefined;
  }
  return obj;
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

    let timings: Record<string, unknown> | undefined;
    const rawTimings = formData.get('timings');
    if (typeof rawTimings === 'string' && rawTimings.trim()) {
      try {
        timings = normalizeTimingsInput(JSON.parse(rawTimings));
      } catch {
        // Silently drop malformed timings — not worth failing the post.
        timings = undefined;
      }
    }

    const messageId = await storeAssistantMessageWithAttachments(
      params.conversationId,
      content,
      files,
      { timings }
    );
    return json({ ok: true, messageId }, { status: 201 });
  }

  const body = await request.json().catch(() => ({}));

  // ----- Chunked streaming path -----------------------------------------
  // Hermes can post incremental token deltas instead of (or before) a final
  // content payload by sending { delta, seq, done, messageId? }. The first
  // chunk omits messageId to open a new streaming message; subsequent chunks
  // pass back the returned id.
  if (typeof body.delta === 'string' || body.done === true) {
    const seq = Number.isFinite(body.seq) ? Number(body.seq) : 0;
    const delta = typeof body.delta === 'string' ? body.delta : '';
    const done = body.done === true;
    let messageId = typeof body.messageId === 'string' ? body.messageId : '';

    if (!messageId) {
      messageId = await openStreamingAssistantMessage(params.conversationId);
    }

    if (delta) {
      await appendAssistantChunk(messageId, seq, delta);
    }

    if (done) {
      const finalContent =
        typeof body.content === 'string' ? body.content : '';
      const timings = normalizeTimingsInput(body.timings);
      // If the producer didn't pass an explicit final content payload, the
      // chunk log itself is the source of truth — finalizeStreamingAssistantMessage
      // assumes the caller passes the assembled content. Fall back to assembling.
      if (finalContent) {
        await finalizeStreamingAssistantMessage(messageId, finalContent, { timings });
      } else {
        const { listAssistantChunks } = await import('$server/chat');
        const chunks = await listAssistantChunks(messageId, -1);
        const assembled = chunks.map((row) => row.delta).join('');
        await finalizeStreamingAssistantMessage(messageId, assembled, { timings });
      }
    }

    return json({ ok: true, messageId, seq, done }, { status: 200 });
  }

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
    ? await storeAssistantMessageWithAttachments(
        params.conversationId,
        content,
        attachments,
        { timings: normalizeTimingsInput(body.timings) }
      )
    : await storeAssistantMessage(
        params.conversationId,
        content,
        { timings: normalizeTimingsInput(body.timings) }
      );

  return json({ ok: true, messageId }, { status: 201 });
}
