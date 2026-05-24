<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import BriefingStatusCard from '$lib/components/briefings/BriefingStatusCard.svelte';
	import { startBriefingPreviewStream } from '$lib/services/briefing-preview';
	import type { BriefingPreview, BriefingShareSettings } from '$lib/types/briefing';
	import BriefingPlayer from '$lib/components/briefings/BriefingPlayer.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const initialPreview = data.preview;
	const initialSharing = data.sharing;
	let preview = $state<BriefingPreview>(initialPreview);
	let sharing = $state<BriefingShareSettings>(initialSharing);
	let pollError = $state<string | null>(null);

	$effect(() => {
		preview = data.preview;
		sharing = data.sharing;
		pollError = null;
	});

	$effect(() => {
		if (!browser) {
			return;
		}

		const routeId = preview.jobId;
		const expectedPath = `${base}/briefings/${encodeURIComponent(routeId)}/player`;
		if (window.location.pathname !== expectedPath) {
			void goto(expectedPath, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	$effect(() => {
		if (!browser || preview.state !== 'processing') {
			return;
		}

		const stopStreaming = startBriefingPreviewStream({
			jobId: preview.jobId,
			basePath: base,
			onUpdate: (nextPreview) => {
				preview = nextPreview;
			},
			onError: (message) => {
				pollError = message;
			}
		});

		return () => {
			stopStreaming();
		};
	});

	function pageTitle() {
		if (preview.state === 'ready') {
			return `${preview.title} · Briefing Player`;
		}

		if (preview.state === 'processing') {
			return 'Generating Briefing Player';
		}

		return 'Briefing Player';
	}

	function currentPlayerHref() {
		return `/briefings/${encodeURIComponent(preview.jobId)}/player`;
	}
</script>

<svelte:head>
	<title>{pageTitle()}</title>
</svelte:head>

<section class="briefing-preview-page">
	<div class="briefing-preview-shell">
		<a class="back-link" href={`${base}/briefings`} aria-label="Back to briefings">
			<span aria-hidden="true">&larr;</span>
			<span>Back to briefings</span>
		</a>

		{#if preview.state === 'ready'}
			<BriefingPlayer briefing={preview} sharing={sharing} />
		{:else}
			<BriefingStatusCard
				preview={preview}
				refreshHref={currentPlayerHref()}
				rerenderBriefingAction={sharing.canManage ? sharing.standalonePath : null}
				regenerateBriefingAction={sharing.canManage ? sharing.standalonePath : null}
				pollError={pollError}
			/>
		{/if}
	</div>
</section>

<style>
	.briefing-preview-page {
		min-height: 100dvh;
		padding: 2rem 1.25rem 4rem;
		background:
			radial-gradient(circle at top left, rgba(14, 116, 144, 0.12), transparent 28%),
			radial-gradient(circle at top right, rgba(15, 118, 110, 0.08), transparent 32%),
			linear-gradient(180deg, #f8fafc 0%, #eef6ff 48%, #f8fafc 100%);
	}

	.briefing-preview-shell {
		max-width: 1320px;
		margin: 0 auto;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		margin: 0 0 1rem;
		padding: 0.75rem 1rem;
		border-radius: 999px;
		border: 1px solid rgba(15, 23, 42, 0.12);
		background: rgba(255, 255, 255, 0.78);
		color: #134e4a;
		font: 600 0.95rem/1 "Avenir Next", "Segoe UI", sans-serif;
		text-decoration: none;
		backdrop-filter: blur(10px);
		box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
		transition: transform 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
	}

	.back-link:hover {
		transform: translateX(-2px);
		background: rgba(255, 255, 255, 0.92);
		box-shadow: 0 16px 36px rgba(15, 23, 42, 0.1);
	}

	.back-link:focus-visible {
		outline: 2px solid #0f766e;
		outline-offset: 3px;
	}

	.back-link span[aria-hidden='true'] {
		font-size: 1.05rem;
	}
</style>