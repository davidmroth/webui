import { getAttachmentBuffer, getAttachmentForUser } from '$server/chat';
import { requireSession } from '$server/auth';

function isHtmlContentType(contentType: string) {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() === 'text/html';
}

export async function GET(event) {
  const session = await requireSession(event);
  const attachment = await getAttachmentForUser(session.userId, event.params.attachmentId);
  if (!attachment) {
    return new Response('Not found', { status: 404 });
  }

  if (!isHtmlContentType(attachment.content_type)) {
    return new Response('Unsupported attachment type', { status: 415 });
  }

  const body = await getAttachmentBuffer(attachment.storage_key);
  const safeFileName = attachment.file_name.replace(/["\\]/g, '_');
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': attachment.content_type,
      'Content-Length': String(body.length),
      'Content-Disposition': `inline; filename="${safeFileName}"`,
      'Cache-Control': 'no-store',
      'Content-Security-Policy': [
        "default-src 'none'",
        "base-uri 'none'",
        "connect-src 'none'",
        "font-src data:",
        "form-action 'none'",
        "frame-ancestors 'self'",
        "img-src data: blob:",
        "media-src data: blob:",
        "sandbox",
        "script-src 'none'",
        "style-src 'unsafe-inline'"
      ].join('; '),
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}