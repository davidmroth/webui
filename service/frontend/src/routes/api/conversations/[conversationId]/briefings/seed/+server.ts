import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import { loadBriefingPreview } from '$server/briefings';
import { getConversationOwnerId, storeAssistantMessage } from '$server/chat';
import type { BriefingReference, BriefingPreview } from '$lib/types-legacy';

function buildBriefingReference(preview: Awaited<ReturnType<typeof loadBriefingPreview>> & { state: 'ready' }): BriefingReference {
  return {
    schemaVersion: 'briefing-reference/v1',
    jobId: preview.jobId,
    briefingId: preview.briefingId,
    title: preview.title,
    summary: preview.summary,
    generatedAt: preview.generatedAt,
    previewUrl: `/briefings/${encodeURIComponent(preview.jobId)}`,
    validation: {
      valid: preview.validation.valid,
      warningCount: preview.validation.warnings.length,
      errorCount: preview.validation.errors.length
    }
  };
}

function statusCodeForPreviewState(preview: Awaited<ReturnType<typeof loadBriefingPreview>>) {
  switch (preview.state) {
    case 'processing':
      return 202;
    case 'failed':
      return 409;
    case 'missing':
      return 404;
    case 'error':
      return 502;
    default:
      return 200;
  }
}

function previewErrorPayload(preview: Awaited<ReturnType<typeof loadBriefingPreview>>) {
  switch (preview.state) {
    case 'processing':
      return {
        error: 'The briefing job is still processing.',
        preview
      };
    case 'failed':
      return {
        error: preview.error ?? 'The briefing job failed.',
        preview
      };
    case 'missing':
      return {
        error: preview.message,
        preview
      };
    case 'error':
      return {
        error: preview.message,
        detail: preview.detail,
        preview
      };
    default:
      return {
        error: 'The briefing preview is not ready.',
        preview
      };
  }
}

function defaultSeedMessage(reference: BriefingReference) {
  return `Created briefing preview: [${reference.title}](${reference.previewUrl})`;
}

export async function POST(event) {
  if (!dev) {
    return json({ error: 'Not found.' }, { status: 404 });
  }

  const session = await requireSession(event);
  const ownerId = await getConversationOwnerId(event.params.conversationId);
  if (!ownerId || ownerId !== session.userId) {
    return json({ error: 'Conversation not found.' }, { status: 404 });
  }

  const body = await event.request.json().catch(() => ({}));
  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
  if (!jobId) {
    return json({ error: 'jobId is required.' }, { status: 400 });
  }

  const preview = await loadBriefingPreview(jobId);
  if (preview.state !== 'ready') {
    return json(previewErrorPayload(preview), { status: statusCodeForPreviewState(preview) });
  }

  const briefingReference = buildBriefingReference(preview);
  const content =
    typeof body.content === 'string' && body.content.trim().length > 0
      ? body.content.trim()
      : defaultSeedMessage(briefingReference);

  const messageId = await storeAssistantMessage(event.params.conversationId, content, {
    briefingReference
  });

  return json(
    {
      ok: true,
      messageId,
      briefingReference
    },
    { status: 201 }
  );
}