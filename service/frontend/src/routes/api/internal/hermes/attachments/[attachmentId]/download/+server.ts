import { getAttachmentBuffer, getAttachmentForInternal } from '$server/chat';
import { getConfig } from '$server/env';
import { isInlineAttachmentContentType } from '$lib/utils/attachment-content-type';

function isAuthorized(request: Request) {
  const expected = getConfig().hermesServiceToken;
  const authHeader = request.headers.get('authorization') || '';
  return authHeader === `Bearer ${expected}`;
}

export async function GET({ params, request }) {
  if (!isAuthorized(request)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const attachment = await getAttachmentForInternal(params.attachmentId);
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
