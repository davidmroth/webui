import { getAttachmentBuffer, getAttachmentForUser } from '$server/chat';
import { requireSession } from '$server/auth';
import { isInlineAttachmentContentType } from '$lib/utils/attachment-content-type';

export async function GET(event) {
  const session = await requireSession(event);
  const attachment = await getAttachmentForUser(session.userId, event.params.attachmentId);
  if (!attachment) {
    return new Response('Not found', { status: 404 });
  }

  const body = await getAttachmentBuffer(attachment.storage_key);
  const contentDisposition = isInlineAttachmentContentType(attachment.content_type) ? 'inline' : 'attachment';
  const safeFileName = attachment.file_name.replace(/["\\]/g, '_');
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': attachment.content_type,
      'Content-Length': String(body.length),
      'Content-Disposition': `${contentDisposition}; filename="${safeFileName}"`
    }
  });
}
