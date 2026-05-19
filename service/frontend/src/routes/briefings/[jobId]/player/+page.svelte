<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import BriefingStatusCard from '$lib/components/briefings/BriefingStatusCard.svelte';
	import { startBriefingPreviewPolling } from '$lib/services/briefing-preview';
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

		const stopPolling = startBriefingPreviewPolling({
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
			stopPolling();
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
		{#if preview.state === 'ready'}
			<BriefingPlayer briefing={preview} sharing={sharing} />
		{:else}
			<BriefingStatusCard
				preview={preview}
				refreshHref={currentPlayerHref()}
				retryBriefingAction={sharing.canManage ? sharing.standalonePath : null}
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
</style>