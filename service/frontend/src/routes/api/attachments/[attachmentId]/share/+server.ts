import { json } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import { ensurePreviewShare } from '$server/preview-sharing';

export async function POST(event) {
  const session = await requireSession(event);

  try {
    const share = await ensurePreviewShare(event.params.attachmentId, session.userId);
    return json({
      shareId: share.shareId,
      isPublic: share.isPublic,
      previewPath: `/previews/${share.shareId}`
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes('not found') || error.message.includes('required'))) {
      return json({ error: error.message }, { status: 404 });
    }
    return json({ error: 'Unable to create preview share.' }, { status: 500 });
  }
}

export async function GET(event) {
  const session = await requireSession(event);

  try {
    const share = await ensurePreviewShare(event.params.attachmentId, session.userId);
    return json({
      shareId: share.shareId,
      isPublic: share.isPublic,
      previewPath: `/previews/${share.shareId}`
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes('not found') || error.message.includes('required'))) {
      return json({ error: error.message }, { status: 404 });
    }
    return json({ error: 'Unable to get preview share.' }, { status: 500 });
  }
}
