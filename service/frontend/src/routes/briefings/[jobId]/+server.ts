import { redirect } from '@sveltejs/kit';
import { rewriteStandaloneAssetUrls } from '$lib/server/briefing-standalone-html';
import { getBriefingViewerAccess } from '$server/briefing-sharing';
import { buildPublicBriefingIssue, fetchBriefingAsset, loadBriefingPreview } from '$server/briefings';
import {
	renderBriefingUnauthorizedPage,
	renderBriefingStatusPage,
	statusCodeForBriefingPreviewState
} from '$lib/server/briefing-status-page';

function buildRetryHref(pathname: string) {
	return `${pathname}?retry=1`;
}

async function loadStandaloneHtml(
	jobId: string,
	assetPath: string,
	requestHeaders: Headers,
	management?: {
		canManage: boolean;
		isPublic: boolean;
		standalonePath: string;
	}
) {
	let upstream: Response;
	try {
		upstream = await fetchBriefingAsset(jobId, assetPath, {
			requestHeaders
		});
	} catch (error) {
		const issue = buildPublicBriefingIssue(
			error instanceof Error ? error.message : 'Unable to load the published briefing export.',
			'Unable to load the published briefing export.',
			{
				retryable: true,
				timeoutMessage: 'The published briefing export timed out while loading.',
				timeoutDetail: 'Retry loading the briefing. The export may already be available.'
			}
		);
		return new Response(
			renderBriefingStatusPage({
				state: 'error',
				status: 'error',
				jobId,
				message: issue.message,
				detail: issue.detail,
				canRetry: issue.canRetry
			}),
			{
				status: 502,
				headers: {
					'cache-control': 'private, max-age=0, must-revalidate',
					'content-type': 'text/html; charset=utf-8',
					'x-content-type-options': 'nosniff'
				}
			}
		);
	}

	if (!upstream.ok) {
		await upstream.text();
		const safeStatus = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status;
		if (safeStatus === 404) {
			throw redirect(307, `/briefings/${encodeURIComponent(jobId)}/player`);
		}
		const issue = buildPublicBriefingIssue(
			null,
			'Unable to load the published briefing HTML.',
			{
				retryable: safeStatus >= 500,
				timeoutMessage: 'The published briefing export timed out while loading.',
				timeoutDetail: 'Retry loading the briefing. The export may already be available.'
			}
		);
		return new Response(
			renderBriefingStatusPage({
				state: 'error',
				status: 'error',
				jobId,
				message: issue.message,
				detail: issue.detail,
				canRetry: issue.canRetry
			}),
			{
				status: safeStatus,
				headers: {
					'cache-control': 'private, max-age=0, must-revalidate',
					'content-type': 'text/html; charset=utf-8',
					'x-content-type-options': 'nosniff'
				}
			}
		);
	}

	const standaloneHtml = rewriteStandaloneAssetUrls(await upstream.text(), jobId, management);
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
	const session = event.locals.session;
	const access = await getBriefingViewerAccess(event.params.jobId, session?.userId ?? null);
	if (!access.canView) {
		return new Response(renderBriefingUnauthorizedPage(event.params.jobId), {
			status: 401,
			headers: {
				'cache-control': 'private, max-age=0, must-revalidate',
				'content-type': 'text/html; charset=utf-8',
				'x-content-type-options': 'nosniff'
			}
		});
	}

	const preview = await loadBriefingPreview(event.params.jobId);

	const retryRequested = event.url.searchParams.get('retry') === '1';
	if (preview.state === 'failed' && preview.canRetry && retryRequested) {
		const retryResponse = await loadStandaloneHtml(preview.jobId, 'standalone.html', event.request.headers, {
			canManage: access.canManage,
			isPublic: access.isPublic,
			standalonePath: `/briefings/${encodeURIComponent(preview.jobId)}`
		});
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
	return loadStandaloneHtml(resolvedJobId, standaloneAssetPath, event.request.headers, {
		canManage: access.canManage,
		isPublic: access.isPublic,
		standalonePath: `/briefings/${encodeURIComponent(resolvedJobId)}`
	});
}