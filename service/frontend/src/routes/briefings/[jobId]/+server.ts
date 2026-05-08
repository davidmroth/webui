import { json } from '@sveltejs/kit';
import { rewriteStandaloneAssetUrls } from '$lib/server/briefing-standalone-html';
import { requireSession } from '$server/auth';
import { fetchBriefingAsset, loadBriefingPreview } from '$server/briefings';
import {
	renderBriefingStatusPage,
	statusCodeForBriefingPreviewState
} from '$lib/server/briefing-status-page';

export async function GET(event) {
	await requireSession(event);

	const preview = await loadBriefingPreview(event.params.jobId);
	if (preview.state !== 'ready') {
			return new Response(renderBriefingStatusPage(preview), {
				status: statusCodeForBriefingPreviewState(preview.state),
				headers: {
					'cache-control': preview.state === 'processing' ? 'no-store' : 'private, max-age=0, must-revalidate',
					'content-type': 'text/html; charset=utf-8',
					'x-content-type-options': 'nosniff'
				}
			});
	}

	const resolvedJobId = preview.jobId;
	const standaloneAssetPath = preview.exportHtmlAsset?.path ?? 'standalone.html';

	let upstream: Response;
	try {
		upstream = await fetchBriefingAsset(resolvedJobId, standaloneAssetPath, {
			requestHeaders: event.request.headers
		});
	} catch (error) {
		return json(
			{
				error: error instanceof Error ? error.message : 'Unable to reach the briefing service.'
			},
			{ status: 502 }
		);
	}

	if (!upstream.ok) {
		const errorText = await upstream.text();
		const safeStatus = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status;
		return new Response(errorText || JSON.stringify({ error: 'Unable to fetch briefing HTML.' }), {
			status: safeStatus,
			headers: {
				'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8'
			}
		});
	}

	const standaloneHtml = rewriteStandaloneAssetUrls(await upstream.text(), resolvedJobId);
	const headers = new Headers();
	for (const headerName of [
		'content-type',
		'cache-control',
		'content-disposition'
	]) {
		const headerValue = upstream.headers.get(headerName);
		if (headerValue) {
			headers.set(headerName, headerValue);
		}
	}
	if (!headers.has('cache-control')) {
		headers.set('cache-control', 'private, max-age=60');
	}
	headers.set('content-type', 'text/html; charset=utf-8');
	headers.set('x-content-type-options', 'nosniff');

	return new Response(standaloneHtml, {
		status: upstream.status,
		headers
	});
}