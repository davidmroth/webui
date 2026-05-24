import { redirect } from '@sveltejs/kit';
import { buildBriefingPageHtml } from '$lib/server/briefing-standalone-html';
import { getBriefingViewerAccess } from '$server/briefing-sharing';
import { loadBriefingPreview } from '$server/briefings';
import { requireSession } from '$server/auth';
import { enqueueBriefingRerender } from '$server/briefing-render-jobs';
import { queueBriefingRegenerationRequest } from '$server/briefing-regenerate';
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
				rerenderBriefingAction: access.canManage ? buildRetryBriefingAction(event.url.pathname) : null,
				regenerateBriefingAction: access.canManage ? buildRetryBriefingAction(event.url.pathname) : null
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
	const formData = await event.request.formData();
	const intent = String(formData.get('intent') || 'rerender').trim();
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
	const canRerenderFromPage =
		preview.state === 'processing' || (preview.state === 'failed' && preview.canRetry);
	if (!canRerenderFromPage) {
		throw redirect(303, event.url.pathname);
	}

	if (intent === 'regenerate') {
		if (preview.state !== 'failed') {
			throw redirect(303, event.url.pathname);
		}

		const requestedChanges = formData
			.getAll('requestedChanges')
			.map((value) => String(value).trim())
			.filter(Boolean);
		const queued = await queueBriefingRegenerationRequest(session.userId, preview.jobId, requestedChanges);
		if (!queued) {
			throw redirect(303, event.url.pathname);
		}

		throw redirect(303, `/chat?conversation=${encodeURIComponent(queued.conversationId)}`);
	}

	const queuedRender = await enqueueBriefingRerender(preview.jobId, session.userId);
	if (!queuedRender) {
		throw redirect(303, event.url.pathname);
	}

	throw redirect(303, event.url.pathname);
}