import { json } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import { fetchBriefingAsset, normalizeAssetPath } from '$server/briefings';

export async function GET(event) {
	await requireSession(event);
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
				error: error instanceof Error ? error.message : 'Unable to reach the briefing service.'
			},
			{ status: 502 }
		);
	}

	if (!upstream.ok) {
		const errorText = await upstream.text();
		const safeStatus = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status;
		return new Response(errorText || JSON.stringify({ error: 'Unable to fetch briefing asset.' }), {
			status: safeStatus,
			headers: {
				'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8'
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
