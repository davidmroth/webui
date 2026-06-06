import { getAttachmentBuffer, getAttachmentForUser } from '$server/chat';
import { requireSession } from '$server/auth';
import { buildMarkdownPreviewDocument } from '$lib/utils/attachment-preview';
import {
	isHtmlAttachmentContentType,
	isMarkdownAttachmentContentType
} from '$lib/utils/attachment-content-type';

export async function GET(event) {
  const session = await requireSession(event);
  const attachment = await getAttachmentForUser(session.userId, event.params.attachmentId);
  if (!attachment) {
    return new Response('Not found', { status: 404 });
  }

  const isHtml = isHtmlAttachmentContentType(attachment.content_type);
  const isMarkdown = isMarkdownAttachmentContentType(attachment.content_type);

  if (!isHtml && !isMarkdown) {
    return new Response('Unsupported attachment type', { status: 415 });
  }

  const body = await getAttachmentBuffer(attachment.storage_key);
  const safeFileName = attachment.file_name.replace(/["\\]/g, '_');
  const responseBody = isMarkdown
    ? buildMarkdownPreviewDocument(new TextDecoder().decode(body), attachment.file_name)
    : new Uint8Array(body);
  const contentLength =
    typeof responseBody === 'string' ? new TextEncoder().encode(responseBody).length : body.length;

  return new Response(responseBody, {
    status: 200,
    headers: {
      'Content-Type': isMarkdown ? 'text/html; charset=utf-8' : attachment.content_type,
      'Content-Length': String(contentLength),
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