import { getAttachmentBuffer, getAttachmentForUser } from '$server/chat';
import { requireSession } from '$server/auth';

export async function GET(event) {
  const session = await requireSession(event);
  const attachment = await getAttachmentForUser(session.userId, event.params.attachmentId);
  if (!attachment) {
    return new Response('Not found', { status: 404 });
  }

  const body = await getAttachmentBuffer(attachment.storage_key);
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': attachment.content_type,
      'Content-Length': String(body.length),
      'Content-Disposition': `inline; filename="${attachment.file_name}"`
    }
  });
}
