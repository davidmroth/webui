import { json } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import { setPreviewPublicState } from '$server/preview-sharing';

export async function POST(event) {
  const session = await requireSession(event);
  const body = await event.request.json().catch(() => ({}));
  const isPublic = body?.isPublic === true;

  try {
    const sharing = await setPreviewPublicState(event.params.shareId, session.userId, isPublic);
    return json({
      isPublic: sharing.isPublic,
      previewPath: `/previews/${encodeURIComponent(sharing.shareId)}`
    });
  } catch (routeError) {
    if (routeError instanceof Error && (routeError.message.includes('Only the') || routeError.message.includes('not found'))) {
      return json({ error: 'Not found.' }, { status: 404 });
    }

    return json({ error: 'Unable to update preview sharing.' }, { status: 500 });
  }
}
