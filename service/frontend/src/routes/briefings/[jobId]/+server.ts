import { json } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import { fetchBriefingAsset, loadBriefingPreview } from '$server/briefings';

function injectStandaloneAssetBase(html: string, jobId: string) {
	const assetBaseHref = `/api/briefings/${encodeURIComponent(jobId)}/assets/`;
	const baseTag = `  <base href="${assetBaseHref}" />`;

	if (html.includes('<base ')) {
		return html;
	}

	if (html.includes('<head>')) {
		return html.replace('<head>', `<head>\n${baseTag}`);
	}

	return html;
}

export async function GET(event) {
	await requireSession(event);

	const preview = await loadBriefingPreview(event.params.jobId);
	if (preview.state !== 'ready') {
		const status =
			preview.state === 'missing'
				? 404
				: preview.state === 'failed'
					? 409
					: preview.state === 'processing'
						? 202
						: 502;
		return json(preview, { status });
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

	const standaloneHtml = injectStandaloneAssetBase(await upstream.text(), resolvedJobId);
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