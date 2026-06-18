import type { RequestHandler } from './$types';
import { getPreviewViewerAccess } from '$server/preview-sharing';
import { query } from '$server/db';
import { isHtmlAttachmentContentType, isMarkdownAttachmentContentType } from '$lib/utils/attachment-content-type';
import { buildMarkdownPreviewDocument } from '$lib/utils/attachment-preview';

interface AttachmentRow {
  id: string;
  file_name: string;
  content_type: string;
  storage_key: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function buildUnauthorizedHtml(shareId: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview not available</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; color: #333; }
  .card { background: #fff; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 400px; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { margin: 0; color: #666; }
</style>
</head>
<body>
<div class="card">
  <h1>Preview not available</h1>
  <p>This preview is private. Only the owner can view it.</p>
</div>
</body>
</html>`;
}

function buildLoadingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Loading preview...</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
  .spinner { width: 40px; height: 40px; border: 3px solid #ccc; border-top-color: #333; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="spinner"></div>
</body>
</html>`;
}

export const GET: RequestHandler = async (event) => {
  const session = event.locals.session;
  const access = await getPreviewViewerAccess(event.params.shareId, session?.userId ?? null);

  if (!access.canView) {
    return new Response(buildUnauthorizedHtml(event.params.shareId), {
      status: 401,
      headers: {
        'cache-control': 'private, max-age=0, must-revalidate',
        'content-type': 'text/html; charset=utf-8',
        'x-content-type-options': 'nosniff'
      }
    });
  }

  // Fetch attachment details (no user check for public access)
  const rows = await query<AttachmentRow>(
    `SELECT attachments.id, attachments.file_name, attachments.content_type, attachments.storage_key
     FROM attachments
     WHERE attachments.id = (
       SELECT attachment_id FROM preview_shares WHERE share_id = :share_id LIMIT 1
     )
     LIMIT 1`,
    { share_id: event.params.shareId }
  );

  const attachment = rows[0];
  if (!attachment) {
    return new Response(buildUnauthorizedHtml(event.params.shareId), {
      status: 404,
      headers: {
        'cache-control': 'private, max-age=0, must-revalidate',
        'content-type': 'text/html; charset=utf-8',
        'x-content-type-options': 'nosniff'
      }
    });
  }

  const isHtml = isHtmlAttachmentContentType(attachment.content_type);
  const isMarkdown = isMarkdownAttachmentContentType(attachment.content_type);

  if (!isHtml && !isMarkdown) {
    return new Response(buildUnauthorizedHtml(event.params.shareId), {
      status: 404,
      headers: {
        'cache-control': 'private, max-age=0, must-revalidate',
        'content-type': 'text/html; charset=utf-8',
        'x-content-type-options': 'nosniff'
      }
    });
  }

  // Fetch attachment content from storage
  const { getAttachmentBuffer } = await import('$server/chat');
  const body = await getAttachmentBuffer(attachment.storage_key);

  let htmlContent: string;
  if (isMarkdown) {
    htmlContent = buildMarkdownPreviewDocument(new TextDecoder().decode(body), attachment.file_name);
  } else {
    htmlContent = new TextDecoder().decode(body);
  }

  // Inject management bar for authenticated owner
  if (session?.userId && access.canManage) {
    const sharePath = `/previews/${event.params.shareId}`;
    const managementBar = `
<aside id="preview-share-manager" data-share-id="${escapeHtml(event.params.shareId)}" data-public="${access.isPublic ? 'true' : 'false'}" data-standalone-path="${escapeHtml(sharePath)}">
  <link rel="stylesheet" href="/preview-standalone-management.css">
  <button type="button" id="preview-share-launcher" aria-haspopup="dialog" aria-expanded="false">Manage access</button>
  <div id="preview-share-dialog" aria-hidden="true">
    <section id="preview-share-panel" role="dialog" aria-modal="true" aria-labelledby="preview-share-title">
      <div id="preview-share-panel-header">
        <div class="share-manager-copy">
          <div class="share-manager-kicker">Access</div>
          <div class="share-manager-status" id="preview-share-title">${access.isPublic ? 'HTML export is public' : 'HTML export is private'}</div>
          <div class="share-manager-detail">${access.isPublic ? 'Anyone with this link can open it.' : 'Authentication is required until you explicitly make this export public.'}</div>
        </div>
        <button type="button" id="preview-share-close" aria-label="Close access panel">×</button>
      </div>
      <div class="share-manager-actions">
        <button type="button" id="share-toggle-button">${access.isPublic ? 'Make private' : 'Make public'}</button>
        <button type="button" id="share-copy-button" class="secondary">Copy link</button>
      </div>
      <div id="share-manager-message" class="share-manager-message" aria-live="polite"></div>
    </section>
  </div>
  <script src="/preview-standalone-management.js"></script>
</aside>`;

    // Inject management bar into body
    if (/<body[^>]*>/i.test(htmlContent)) {
      htmlContent = htmlContent.replace(/<body([^>]*)>/i, `<body$1>${managementBar}`);
    } else {
      htmlContent = managementBar + htmlContent;
    }
  }

  return new Response(htmlContent, {
    status: 200,
    headers: {
      'cache-control': access.isPublic ? 'public, max-age=300' : 'private, max-age=60',
      'content-type': isMarkdown ? 'text/html; charset=utf-8' : attachment.content_type,
      'x-content-type-options': 'nosniff'
    }
  });
};
