<script lang="ts">
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import BriefingStatusCard from '$lib/components/briefings/BriefingStatusCard.svelte';
	import { startBriefingPreviewPolling } from '$lib/services/briefing-preview';
	import type { BriefingPreview } from '$lib/types/briefing';
	import BriefingPlayer from '$lib/components/briefings/BriefingPlayer.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let preview = $state<BriefingPreview>(data.preview);
	let pollError = $state<string | null>(null);

	$effect(() => {
		preview = data.preview;
		pollError = null;
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
			return `${preview.title} · Briefing Preview`;
		}

		if (preview.state === 'processing') {
			return 'Generating Briefing';
		}

		return 'Briefing Preview';
	}

	function currentPreviewHref() {
		return `/briefings/${encodeURIComponent(preview.jobId)}`;
	}
</script>

<svelte:head>
	<title>{pageTitle()}</title>
</svelte:head>

<div class="briefing-preview-page">
	{#if preview.state === 'ready'}
		<BriefingPlayer briefing={preview} />
	{:else}
		<BriefingStatusCard preview={preview} refreshHref={currentPreviewHref()} pollError={pollError} />
	{/if}
</div>

<style>
	.briefing-preview-page {
		max-width: 1320px;
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
	}
</style>