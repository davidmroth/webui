import { json } from '@sveltejs/kit';
import { getBriefingViewerAccess } from '$server/briefing-sharing';
import { buildPublicBriefingIssue, fetchBriefingAsset, normalizeAssetPath } from '$server/briefings';

export async function GET(event) {
	const session = event.locals.session;
	const access = await getBriefingViewerAccess(event.params.jobId, session?.userId ?? null);
	if (!access.canView) {
		return json({ error: 'Unauthorized.' }, { status: 401 });
	}

	const assetPath = normalizeAssetPath(event.params.assetPath ?? '');
	if (!assetPath) {
		return json({ error: 'A valid briefing asset path is required.' }, { status: 400 });
	}

	let upstream: Response;
	try {
		upstream = await fetchBriefingAsset(event.params.jobId, assetPath, {
			requestHeaders: event.request.headers
		});
	} catch (error) {
		return json(
			{
				error: buildPublicBriefingIssue(
					error instanceof Error ? error.message : 'Unable to load the published briefing asset.',
					'Unable to load the published briefing asset.',
					{
						retryable: true,
						timeoutMessage: 'The published briefing asset timed out while loading.',
						timeoutDetail: 'Retry loading the briefing asset in a moment.'
					}
				).message
			},
			{ status: 502 }
		);
	}

	if (upstream.status >= 400) {
		await upstream.text();
		const safeStatus = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status;
		const issue = buildPublicBriefingIssue(
			null,
			'Unable to fetch the published briefing asset.',
			{
				retryable: safeStatus >= 500,
				timeoutMessage: 'The published briefing asset timed out while loading.',
				timeoutDetail: 'Retry loading the briefing asset in a moment.'
			}
		);
		return new Response(JSON.stringify({ error: issue.message }), {
			status: safeStatus,
			headers: {
				'content-type': 'application/json; charset=utf-8'
			}
		});
	}

	const headers = new Headers();
	for (const headerName of [
		'content-type',
		'content-length',
		'cache-control',
		'accept-ranges',
		'content-range',
		'etag',
		'last-modified',
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
	headers.set('x-content-type-options', 'nosniff');

	return new Response(upstream.body, {
		status: upstream.status,
		headers
	});
}
