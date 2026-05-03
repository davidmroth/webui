<script lang="ts">
	import BriefingPlayer from '$lib/components/briefings/BriefingPlayer.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function pageTitle() {
		if (data.preview.state === 'ready') {
			return `${data.preview.title} · Briefing Preview`;
		}

		return 'Briefing Preview';
	}

	function currentPreviewHref() {
		return `/briefings/${encodeURIComponent(data.preview.jobId)}`;
	}
</script>

<svelte:head>
	<title>{pageTitle()}</title>
</svelte:head>

<div class="briefing-preview-page">
	{#if data.preview.state === 'ready'}
		<BriefingPlayer briefing={data.preview} />
	{:else}
		<section class="briefing-status-card">
			<p class="briefing-status-kicker">Briefing preview</p>
			<h1>
				{#if data.preview.state === 'processing'}
					Renderer job is still processing
				{:else if data.preview.state === 'failed'}
					Renderer job failed
				{:else if data.preview.state === 'missing'}
					Renderer job not found
				{:else}
					Briefing preview unavailable
				{/if}
			</h1>

			{#if data.preview.state === 'processing'}
				<p>
					This briefing job has not finished rendering yet. Refresh the page after the renderer
					completes.
				</p>
				<p class="briefing-status-meta">Job id: {data.preview.jobId}</p>
			{:else if data.preview.state === 'failed'}
				<p>{data.preview.error ?? 'The renderer reported a failure for this job.'}</p>
				<p class="briefing-status-meta">Job id: {data.preview.jobId}</p>
			{:else if data.preview.state === 'missing'}
				<p>{data.preview.message}</p>
			{:else}
				<p>{data.preview.message}</p>
				{#if data.preview.detail}
					<p class="briefing-status-meta">{data.preview.detail}</p>
				{/if}
			{/if}

			<div class="briefing-status-actions">
				<a class="secondary-button" href={currentPreviewHref()}>Refresh</a>
				<a class="secondary-button" href="/chat">Back to chat</a>
			</div>
		</section>
	{/if}
</div>

<style>
	.briefing-preview-page {
		max-width: 1320px;
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
	}

	.briefing-status-card {
		max-width: 44rem;
		margin: 4rem auto;
		padding: 2rem;
		border-radius: 1.5rem;
		background: rgba(255, 255, 255, 0.94);
		border: 1px solid rgba(148, 163, 184, 0.24);
		box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
	}

	.briefing-status-kicker,
	.briefing-status-meta {
		color: rgba(51, 65, 85, 0.8);
	}

	.briefing-status-kicker {
		margin-bottom: 0.4rem;
		font-size: 0.85rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.briefing-status-card h1 {
		margin-top: 0;
		margin-bottom: 0.75rem;
		font-size: clamp(2rem, 3.4vw, 2.8rem);
	}

	.briefing-status-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-top: 1.5rem;
	}
</style>