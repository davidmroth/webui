import { redirect } from '@sveltejs/kit';
import { buildBriefingPageHtml } from '$lib/server/briefing-standalone-html';
import { getBriefingViewerAccess } from '$server/briefing-sharing';
import { loadBriefingPreview } from '$server/briefings';
import { requireSession } from '$server/auth';
import { retryBriefingJob } from '$server/chat';
import {
	renderBriefingUnauthorizedPage,
	renderBriefingStatusPage,
	statusCodeForBriefingPreviewState
} from '$lib/server/briefing-status-page';

function buildRetryHref(pathname: string) {
	return `${pathname}?retry=1`;
}

function buildRetryBriefingAction(pathname: string) {
	return pathname;
}

function respondWithGeneratedHtml(
	preview: import('$lib/types/briefing').BriefingPreviewReady,
	management: { canManage: boolean; isPublic: boolean; standalonePath: string }
) {
	const audioUrl = preview.audioAsset?.url ?? `/api/briefings/${encodeURIComponent(preview.jobId)}/assets/audio.mp3`;
	const html = buildBriefingPageHtml(
		{
			title: preview.title,
			topic: preview.topic,
			generatedAt: preview.generatedAt,
			locale: preview.locale,
			audioUrl,
			sections: preview.sections,
			sources: preview.sources
		},
		preview.jobId,
		management
	);
	return new Response(html, {
		status: 200,
		headers: {
			'cache-control': 'private, max-age=60',
			'content-type': 'text/html; charset=utf-8',
			'x-content-type-options': 'nosniff'
		}
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
		const refreshed = await loadBriefingPreview(preview.jobId);
		if (refreshed.state === 'ready') {
			return respondWithGeneratedHtml(refreshed, {
				canManage: access.canManage,
				isPublic: access.isPublic,
				standalonePath: `/briefings/${encodeURIComponent(refreshed.jobId)}`
			});
		}
	}

	if (preview.state !== 'ready') {
			return new Response(renderBriefingStatusPage(preview, {
				retryHref: buildRetryHref(event.url.pathname),
				retryBriefingAction: access.canManage ? buildRetryBriefingAction(event.url.pathname) : null
			}), {
				status: statusCodeForBriefingPreviewState(preview.state),
				headers: {
					'cache-control': preview.state === 'processing' ? 'no-store' : 'private, max-age=0, must-revalidate',
					'content-type': 'text/html; charset=utf-8',
					'x-content-type-options': 'nosniff'
				}
			});
	}

	const resolvedJobId = preview.jobId;
	return respondWithGeneratedHtml(preview, {
		canManage: access.canManage,
		isPublic: access.isPublic,
		standalonePath: `/briefings/${encodeURIComponent(resolvedJobId)}`
	});
}

export async function POST(event) {
	const session = await requireSession(event);
	const access = await getBriefingViewerAccess(event.params.jobId, session.userId);
	if (!access.canManage) {
		return new Response(renderBriefingUnauthorizedPage(event.params.jobId), {
			status: 403,
			headers: {
				'cache-control': 'private, max-age=0, must-revalidate',
				'content-type': 'text/html; charset=utf-8',
				'x-content-type-options': 'nosniff'
			}
		});
	}

	const preview = await loadBriefingPreview(event.params.jobId);
	if (preview.state !== 'failed' || !preview.canRetry) {
		return new Response(
			renderBriefingStatusPage(preview.state === 'ready'
				? {
					state: 'error',
					status: 'error',
					jobId: event.params.jobId,
					message: 'This briefing is not eligible for retry.',
					detail: 'Only failed briefing jobs can be retried from this page.',
					canRetry: false
				}
				: preview,
			{
				retryHref: buildRetryHref(event.url.pathname),
				retryBriefingAction: access.canManage ? buildRetryBriefingAction(event.url.pathname) : null
			}
		),
			{
				status: 409,
				headers: {
					'cache-control': 'private, max-age=0, must-revalidate',
					'content-type': 'text/html; charset=utf-8',
					'x-content-type-options': 'nosniff'
				}
			}
		);
	}

	const retried = await retryBriefingJob(session.userId, preview.jobId);
	if (!retried) {
		return new Response(
			renderBriefingStatusPage(
				{
					...preview,
					detail:
						'WebUI could not queue a retry for this briefing. Open the originating conversation and retry from chat instead.'
				},
				{
					retryHref: buildRetryHref(event.url.pathname),
					retryBriefingAction: buildRetryBriefingAction(event.url.pathname)
				}
			),
			{
				status: 409,
				headers: {
					'cache-control': 'private, max-age=0, must-revalidate',
					'content-type': 'text/html; charset=utf-8',
					'x-content-type-options': 'nosniff'
				}
			}
		);
	}

	throw redirect(303, `/chat?conversation=${encodeURIComponent(retried.conversationId)}`);
}