import { json, redirect } from '@sveltejs/kit';
import { rewriteStandaloneAssetUrls } from '$lib/server/briefing-standalone-html';
import { requireSession } from '$server/auth';
import { buildPublicBriefingIssue, fetchBriefingAsset, loadBriefingPreview } from '$server/briefings';
import {
	renderBriefingStatusPage,
	statusCodeForBriefingPreviewState
} from '$lib/server/briefing-status-page';

function buildRetryHref(pathname: string) {
	return `${pathname}?retry=1`;
}

async function loadStandaloneHtml(jobId: string, assetPath: string, requestHeaders: Headers) {
	let upstream: Response;
	try {
		upstream = await fetchBriefingAsset(jobId, assetPath, {
			requestHeaders
		});
	} catch (error) {
		return json(
			{
				error: buildPublicBriefingIssue(
					error instanceof Error ? error.message : 'Unable to reach the briefing service.',
					'Unable to reach the briefing service.',
					{
						retryable: true,
						timeoutMessage: 'The briefing service timed out while loading the requested export.',
						timeoutDetail: 'Retry loading the briefing. The export may already be available.'
					}
				).message
			},
			{ status: 502 }
		);
	}

	if (!upstream.ok) {
		await upstream.text();
		const safeStatus = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status;
		const issue = buildPublicBriefingIssue(
			null,
			'Unable to fetch briefing HTML.',
			{
				retryable: safeStatus >= 500,
				timeoutMessage: 'The briefing export timed out while loading.',
				timeoutDetail: 'Retry loading the briefing. The export may already be available.'
			}
		);
		return new Response(JSON.stringify({ error: issue.message }), {
			status: safeStatus,
			headers: {
				'content-type': 'application/json; charset=utf-8'
			}
		});
	}

	const standaloneHtml = rewriteStandaloneAssetUrls(await upstream.text(), jobId);
	const headers = new Headers();
	for (const headerName of ['content-type', 'cache-control', 'content-disposition']) {
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

export async function GET(event) {
	await requireSession(event);

	const preview = await loadBriefingPreview(event.params.jobId);
	if (preview.state !== 'missing' && preview.state !== 'error' && preview.briefingId) {
		const canonicalPath = `/briefings/${encodeURIComponent(preview.briefingId)}`;
		if (event.url.pathname !== canonicalPath) {
			throw redirect(308, canonicalPath);
		}
	}

	const retryRequested = event.url.searchParams.get('retry') === '1';
	if (preview.state === 'failed' && preview.canRetry && retryRequested) {
		const retryResponse = await loadStandaloneHtml(preview.jobId, 'standalone.html', event.request.headers);
		if (retryResponse.ok) {
			return retryResponse;
		}
	}

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
	return loadStandaloneHtml(resolvedJobId, standaloneAssetPath, event.request.headers);
}