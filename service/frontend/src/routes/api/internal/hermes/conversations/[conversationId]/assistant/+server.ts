import { json } from '@sveltejs/kit';
import {
  storeAssistantMessage,
  storeAssistantMessageWithAttachments,
  openStreamingAssistantMessage,
  appendAssistantChunk,
  finalizeStreamingAssistantMessage,
  updateAssistantMessage,
  recordHermesDeliveryTrace
} from '$server/chat';
import { DiagnosticEventType, DiagnosticHop, emitDiagnosticEvent } from '$server/diagnostics';
import { getConfig } from '$server/env';
import { noteHermesWorkerAuthFailure, noteHermesWorkerHeartbeat } from '$server/hermes-heartbeat';
import { isHermesSystemStatusContent } from '$lib/utils/hermes-system-status';

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

interface SenderTraceInput {
  traceId?: unknown;
  route?: unknown;
  senderBaseUrl?: unknown;
  senderTargetUrl?: unknown;
  senderHostname?: unknown;
  sessionPlatform?: unknown;
  sessionChatId?: unknown;
  attachmentCount?: unknown;
  attachmentNames?: unknown;
  contentLength?: unknown;
}

interface NormalizedSenderTrace {
  senderTraceId: string | null;
  route: string;
  senderBaseUrl: string | null;
  senderTargetUrl: string | null;
  senderHostname: string | null;
  senderSessionPlatform: string | null;
  senderSessionChatId: string | null;
  attachmentCount: number;
  attachmentNames: string[];
  contentLength: number;
}

type HermesInboundRole = 'assistant' | 'system';
type HermesDisplayType = 'tool_progress';

function isAuthorized(request: Request) {
  const expected = getConfig().hermesServiceToken;
  const authHeader = request.headers.get('authorization') || '';
  return authHeader === `Bearer ${expected}`;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function createAttachmentUpload(
  fileName: string,
  contentType: string,
  bytes: Uint8Array
): AttachmentUpload {
  return {
    name: fileName,
    type: contentType,
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytesToArrayBuffer(bytes);
    }
  };
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return Math.max(0, Math.floor(fallback));
  }

  return Math.max(0, Math.floor(normalized));
}

function normalizeInboundRole(value: unknown, content = ''): HermesInboundRole {
  if (value === 'system' || value === 'assistant') {
    return value;
  }

  return isHermesSystemStatusContent(content) ? 'system' : 'assistant';
}

function normalizeDisplayType(value: unknown): HermesDisplayType | undefined {
  return value === 'tool_progress' ? 'tool_progress' : undefined;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const decoded = atob(base64);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

function normalizeSenderTraceInput(
  raw: unknown,
  fallback: { attachmentCount: number; attachmentNames: string[]; contentLength: number }
): NormalizedSenderTrace | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const input = raw as SenderTraceInput;
  return {
    senderTraceId: normalizeOptionalString(input.traceId),
    route: normalizeOptionalString(input.route) ?? 'unknown',
    senderBaseUrl: normalizeOptionalString(input.senderBaseUrl),
    senderTargetUrl: normalizeOptionalString(input.senderTargetUrl),
    senderHostname: normalizeOptionalString(input.senderHostname),
    senderSessionPlatform: normalizeOptionalString(input.sessionPlatform),
    senderSessionChatId: normalizeOptionalString(input.sessionChatId),
    attachmentCount: normalizeNonNegativeInteger(input.attachmentCount, fallback.attachmentCount),
    attachmentNames: normalizeStringArray(input.attachmentNames).slice(0, 20),
    contentLength: normalizeNonNegativeInteger(input.contentLength, fallback.contentLength)
  };
}

async function persistSenderTrace(
  conversationId: string,
  senderTrace: NormalizedSenderTrace | null,
  options: { receiverMessageId?: string | null; receiverStatus: 'accepted' | 'rejected'; errorText?: string | null }
) {
  if (!senderTrace) {
    return;
  }

  try {
    await recordHermesDeliveryTrace({
      senderTraceId: senderTrace.senderTraceId,
      conversationId,
      receiverMessageId: options.receiverMessageId ?? null,
      route: senderTrace.route,
      senderBaseUrl: senderTrace.senderBaseUrl,
      senderTargetUrl: senderTrace.senderTargetUrl,
      senderHostname: senderTrace.senderHostname,
      senderSessionPlatform: senderTrace.senderSessionPlatform,
      senderSessionChatId: senderTrace.senderSessionChatId,
      attachmentCount: senderTrace.attachmentCount,
      attachmentNames: senderTrace.attachmentNames,
      contentLength: senderTrace.contentLength,
      receiverStatus: options.receiverStatus,
      errorText: options.errorText ?? null
    });
  } catch {
    // Delivery trace persistence is diagnostic only and must not block message intake.
  }
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
      const bytes = new TextEncoder().encode(attachment.text);
      if (bytes.byteLength === 0) {
        throw new Error(`attachments[${index}] text must not be empty.`);
      }

      return createAttachmentUpload(fileName, contentType, bytes);
    }

    if (typeof attachment.base64Data === 'string') {
      const normalizedBase64 = attachment.base64Data.trim();
      if (!normalizedBase64) {
        throw new Error(`attachments[${index}] base64Data must not be empty.`);
      }

      const bytes = decodeBase64ToBytes(normalizedBase64);
      if (bytes.byteLength === 0) {
        throw new Error(`attachments[${index}] base64Data could not be decoded.`);
      }

      const contentType =
        typeof attachment.contentType === 'string' && attachment.contentType.trim()
          ? attachment.contentType.trim()
          : 'application/octet-stream';

      return createAttachmentUpload(fileName, contentType, bytes);
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

function diagnosticErrorDetails(error: unknown) {
  return {
    errorClass: error instanceof Error ? error.constructor.name : typeof error,
    errorMessage: error instanceof Error ? error.message : 'Unknown assistant receiver error'
  };
}

function emitAssistantDiagnostic(
  eventType: (typeof DiagnosticEventType)[keyof typeof DiagnosticEventType],
  details: Record<string, unknown>,
  conversationId: string
) {
  emitDiagnosticEvent(eventType, DiagnosticHop.WebuiApi, details, conversationId);
}

function getRequestId(request: Request) {
  return request.headers.get('x-request-id')?.trim() || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function POST({ params, request }: { params: { conversationId: string }; request: Request }) {
  if (!isAuthorized(request)) {
    noteHermesWorkerAuthFailure('assistant-post');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  noteHermesWorkerHeartbeat('assistant-post');

  const requestId = getRequestId(request);
  const startedAt = Date.now();

  try {

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const content = String(formData.get('content') || '').trim();
    const role = normalizeInboundRole(formData.get('role'), content);
    const userMessageId = normalizeOptionalString(formData.get('userMessageId'));
    const files = formData
      .getAll('attachments')
      .filter((value: FormDataEntryValue): value is File => value instanceof File && value.size > 0);
    emitAssistantDiagnostic(
      DiagnosticEventType.HermesAssistantPostReceived,
      {
        conversationId: params.conversationId,
        requestId,
        mode: 'multipart_create',
        contentLength: content.length,
        attachmentCount: files.length,
        role
      },
      params.conversationId
    );
    if (!content && files.length === 0) {
      emitAssistantDiagnostic(
        DiagnosticEventType.HermesAssistantPostRejected,
        {
          conversationId: params.conversationId,
          requestId,
          mode: 'multipart_create',
          statusCode: 400,
          reason: 'Assistant content or attachment is required.',
          durationMs: Date.now() - startedAt
        },
        params.conversationId
      );
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
      { timings, role, userMessageId }
    );
    emitAssistantDiagnostic(
      DiagnosticEventType.HermesAssistantPostAccepted,
      {
        conversationId: params.conversationId,
        requestId,
        mode: 'multipart_create',
        messageId,
        statusCode: 201,
        durationMs: Date.now() - startedAt
      },
      params.conversationId
    );
    return json({ ok: true, messageId }, { status: 201 });
  }

  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const rawAttachmentNames = Array.isArray(body.attachments)
    ? body.attachments
        .map((attachment: unknown) => {
          if (!attachment || typeof attachment !== 'object') {
            return null;
          }

          const fileName = (attachment as AssistantJsonAttachment).fileName;
          return typeof fileName === 'string' && fileName.trim() ? fileName.trim() : null;
        })
        .filter((fileName: string | null): fileName is string => Boolean(fileName))
    : [];
  const rawContent = typeof body.content === 'string' ? body.content.trim() : '';
  const displayType = normalizeDisplayType(body.displayType);
  const role = displayType === 'tool_progress' ? 'system' : normalizeInboundRole(body.role, rawContent);
  const userMessageId = normalizeOptionalString(body.userMessageId);
  const senderTrace = normalizeSenderTraceInput(body.senderTrace, {
    attachmentCount: rawAttachmentNames.length,
    attachmentNames: rawAttachmentNames,
    contentLength: rawContent.length
  });
  const normalizedTimings = normalizeTimingsInput(body.timings);
  const traceWithTimingSignal =
    senderTrace && normalizedTimings
      ? { ...senderTrace, route: `${senderTrace.route}+timings` }
      : senderTrace;
  const messageId = normalizeOptionalString(body.messageId);
  const mode = typeof body.delta === 'string' || body.done === true
    ? 'streaming_delta'
    : messageId
      ? 'edit'
      : 'create';
  const diagnosticBase = {
    conversationId: params.conversationId,
    requestId,
    senderTraceId: senderTrace?.senderTraceId ?? null,
    mode,
    messageId,
    contentLength: rawContent.length,
    attachmentCount: rawAttachmentNames.length,
    hasDelta: typeof body.delta === 'string',
    done: body.done === true,
    hasTimings: Boolean(normalizedTimings)
  };
  emitAssistantDiagnostic(DiagnosticEventType.HermesAssistantPostReceived, diagnosticBase, params.conversationId);

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
      messageId = await openStreamingAssistantMessage(params.conversationId, { userMessageId });
    }

    if (delta) {
      await appendAssistantChunk(params.conversationId, messageId, seq, delta);
    }

    if (done) {
      const finalContent =
        typeof body.content === 'string' ? body.content : '';
      // If the producer didn't pass an explicit final content payload, the
      // chunk log itself is the source of truth — finalizeStreamingAssistantMessage
      // assumes the caller passes the assembled content. Fall back to assembling.
      if (finalContent) {
        await finalizeStreamingAssistantMessage(params.conversationId, messageId, finalContent, {
          timings: normalizedTimings
        });
      } else {
        const { listAssistantChunks } = await import('$server/chat');
        const chunks = await listAssistantChunks(messageId, -1);
        const assembled = chunks.map((row) => row.delta).join('');
        await finalizeStreamingAssistantMessage(params.conversationId, messageId, assembled, {
          timings: normalizedTimings
        });
      }
    }

    emitAssistantDiagnostic(
      DiagnosticEventType.HermesAssistantPostAccepted,
      {
        ...diagnosticBase,
        messageId,
        seq,
        statusCode: 200,
        durationMs: Date.now() - startedAt
      },
      params.conversationId
    );
    return json({ ok: true, messageId, seq, done }, { status: 200 });
  }

  const content = typeof body.content === 'string' ? body.content.trim() : '';

  if (messageId) {
    emitAssistantDiagnostic(
      DiagnosticEventType.HermesAssistantUpdateStarted,
      { ...diagnosticBase, status: 'started' },
      params.conversationId
    );
    if (!content) {
      await persistSenderTrace(params.conversationId, traceWithTimingSignal, {
        receiverStatus: 'rejected',
        errorText: 'Assistant update content is required.'
      });
      emitAssistantDiagnostic(
        DiagnosticEventType.HermesAssistantUpdateRejected,
        {
          ...diagnosticBase,
          statusCode: 400,
          reason: 'Assistant update content is required.',
          durationMs: Date.now() - startedAt
        },
        params.conversationId
      );
      return json(
        {
          success: false,
          error: 'Assistant update content is required.',
          error_code: 'HERMES_ASSISTANT_UPDATE_REJECTED',
          error_message: 'Assistant update content is required.'
        },
        { status: 400 }
      );
    }

    if (rawAttachmentNames.length > 0) {
      await persistSenderTrace(params.conversationId, traceWithTimingSignal, {
        receiverStatus: 'rejected',
        errorText: 'Assistant updates do not support attachments.'
      });
      emitAssistantDiagnostic(
        DiagnosticEventType.HermesAssistantUpdateRejected,
        {
          ...diagnosticBase,
          statusCode: 400,
          reason: 'Assistant updates do not support attachments.',
          durationMs: Date.now() - startedAt
        },
        params.conversationId
      );
      return json(
        {
          success: false,
          error: 'Assistant updates do not support attachments.',
          error_code: 'HERMES_ASSISTANT_UPDATE_REJECTED',
          error_message: 'Assistant updates do not support attachments.'
        },
        { status: 400 }
      );
    }

    try {
      await updateAssistantMessage(params.conversationId, messageId, content, {
        timings: normalizedTimings
      });

      await persistSenderTrace(params.conversationId, traceWithTimingSignal, {
        receiverMessageId: messageId,
        receiverStatus: 'accepted'
      });

      emitAssistantDiagnostic(
        DiagnosticEventType.HermesAssistantPostAccepted,
        {
          ...diagnosticBase,
          statusCode: 200,
          durationMs: Date.now() - startedAt
        },
        params.conversationId
      );
      return json({ ok: true, messageId }, { status: 200 });
    } catch (error) {
      const details = diagnosticErrorDetails(error);
      await persistSenderTrace(params.conversationId, traceWithTimingSignal, {
        receiverStatus: 'rejected',
        errorText: details.errorMessage
      });
      emitAssistantDiagnostic(
        DiagnosticEventType.HermesAssistantUpdateFailed,
        {
          ...diagnosticBase,
          ...details,
          statusCode: 500,
          durationMs: Date.now() - startedAt
        },
        params.conversationId
      );
      return json(
        {
          success: false,
          error: details.errorMessage,
          error_code: 'HERMES_ASSISTANT_UPDATE_FAILED',
          error_message: details.errorMessage,
          request_id: requestId
        },
        { status: 500 }
      );
    }
  }

  let attachments: AttachmentUpload[] = [];
  try {
    attachments = parseJsonAttachments(body.attachments);
  } catch (error) {
    const details = diagnosticErrorDetails(error);
    await persistSenderTrace(params.conversationId, traceWithTimingSignal, {
      receiverStatus: 'rejected',
      errorText: details.errorMessage
    });
    emitAssistantDiagnostic(
      DiagnosticEventType.HermesAssistantPostRejected,
      {
        ...diagnosticBase,
        ...details,
        statusCode: 400,
        durationMs: Date.now() - startedAt
      },
      params.conversationId
    );
    return json(
      { error: details.errorMessage, error_code: 'HERMES_ASSISTANT_POST_REJECTED', error_message: details.errorMessage },
      { status: 400 }
    );
  }

  if (!content && attachments.length === 0) {
    await persistSenderTrace(params.conversationId, traceWithTimingSignal, {
      receiverStatus: 'rejected',
      errorText: 'Assistant content or attachment is required.'
    });
    emitAssistantDiagnostic(
      DiagnosticEventType.HermesAssistantPostRejected,
      {
        ...diagnosticBase,
        statusCode: 400,
        reason: 'Assistant content or attachment is required.',
        durationMs: Date.now() - startedAt
      },
      params.conversationId
    );
    return json({ error: 'Assistant content or attachment is required.' }, { status: 400 });
  }

  try {
    const messageId = attachments.length
      ? await storeAssistantMessageWithAttachments(
          params.conversationId,
          content,
          attachments,
          { timings: normalizedTimings, role, displayType, userMessageId }
        )
      : await storeAssistantMessage(
          params.conversationId,
          content,
          { timings: normalizedTimings, role, displayType, userMessageId }
        );

    await persistSenderTrace(params.conversationId, traceWithTimingSignal, {
      receiverMessageId: messageId,
      receiverStatus: 'accepted'
    });

    emitAssistantDiagnostic(
      DiagnosticEventType.HermesAssistantPostAccepted,
      {
        ...diagnosticBase,
        messageId,
        statusCode: 201,
        durationMs: Date.now() - startedAt
      },
      params.conversationId
    );
    return json({ ok: true, messageId }, { status: 201 });
  } catch (error) {
    const details = diagnosticErrorDetails(error);
    await persistSenderTrace(params.conversationId, traceWithTimingSignal, {
      receiverStatus: 'rejected',
      errorText: details.errorMessage
    });
    emitAssistantDiagnostic(
      DiagnosticEventType.HermesAssistantPostFailed,
      {
        ...diagnosticBase,
        ...details,
        statusCode: 500,
        durationMs: Date.now() - startedAt
      },
      params.conversationId
    );
    return json(
      {
        success: false,
        error: details.errorMessage,
        error_code: 'HERMES_ASSISTANT_POST_FAILED',
        error_message: details.errorMessage,
        request_id: requestId
      },
      { status: 500 }
    );
  }
  } catch (error) {
    const details = diagnosticErrorDetails(error);
    emitAssistantDiagnostic(
      DiagnosticEventType.HermesAssistantPostFailed,
      {
        conversationId: params.conversationId,
        requestId,
        ...details,
        statusCode: 500,
        durationMs: Date.now() - startedAt
      },
      params.conversationId
    );
    return json(
      {
        success: false,
        error: details.errorMessage,
        error_code: 'HERMES_ASSISTANT_POST_FAILED',
        error_message: details.errorMessage,
        request_id: requestId
      },
      { status: 500 }
    );
  }
}
