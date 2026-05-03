<script lang="ts">
	import { estimateBriefingRenderProgress } from '$lib/services/briefing-preview';
	import type { BriefingPreview } from '$lib/types/briefing';

	type PendingBriefingPreview = Exclude<BriefingPreview, { state: 'ready' }>;

	interface Props {
		preview: PendingBriefingPreview;
		refreshHref: string;
		pollError?: string | null;
	}

	let { preview, refreshHref, pollError = null }: Props = $props();
	let nowMs = $state(Date.now());

	$effect(() => {
		if (preview.state !== 'processing') {
			return;
		}

		nowMs = Date.now();
		const timer = window.setInterval(() => {
			nowMs = Date.now();
		}, 1_000);

		return () => {
			window.clearInterval(timer);
		};
	});

	const progress = $derived(
		preview.state === 'processing' ? estimateBriefingRenderProgress(preview, nowMs) : null
	);

	function formatDuration(milliseconds: number | null) {
		if (milliseconds === null || Number.isNaN(milliseconds)) {
			return 'Updating soon';
		}

		const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	function heading() {
		if (preview.state === 'processing') {
			return 'Generating briefing';
		}

		if (preview.state === 'failed') {
			return 'Renderer job failed';
		}

		if (preview.state === 'missing') {
			return 'Renderer job not found';
		}

		return 'Briefing preview unavailable';
	}
</script>

<section class="briefing-status-card" aria-live="polite">
	<p class="briefing-status-kicker">Briefing preview</p>
	<h1>{heading()}</h1>

	{#if preview.state === 'processing' && progress}
		<p class="briefing-status-summary">{progress.summary}</p>
		<p class="briefing-status-detail">{progress.detail}</p>

		<div class="briefing-progress-shell">
			<div class="briefing-progress-header">
				<span>Estimated render progress</span>
				<strong>{progress.percent}%</strong>
			</div>
			<div
				class="briefing-progress-track"
				role="progressbar"
				aria-label="Estimated briefing render progress"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={progress.percent}
			>
				<div class="briefing-progress-fill" style={`width: ${progress.percent}%`}></div>
			</div>
			<div class="briefing-progress-meta">
				<span>{progress.stageLabel}</span>
				<span>Elapsed {formatDuration(progress.elapsedMs)}</span>
				<span>
					{#if progress.etaMs === null}
						Usually any moment now
					{:else}
						About {formatDuration(progress.etaMs)} remaining
					{/if}
				</span>
			</div>
		</div>

		<div class="briefing-status-note-row">
			<p class="briefing-status-meta">Job id: {preview.jobId}</p>
			<p class="briefing-status-meta">Auto-refreshing every few seconds</p>
		</div>
	{:else if preview.state === 'failed'}
		<p>{preview.error ?? 'The renderer reported a failure for this job.'}</p>
		<p class="briefing-status-meta">Job id: {preview.jobId}</p>
	{:else if preview.state === 'missing'}
		<p>{preview.message}</p>
	{:else if preview.state === 'error'}
		<p>{preview.message}</p>
		{#if preview.detail}
			<p class="briefing-status-meta">{preview.detail}</p>
		{/if}
	{/if}

	{#if pollError}
		<p class="briefing-status-warning">Status refresh paused briefly: {pollError}</p>
	{/if}

	<div class="briefing-status-actions">
		<a class="secondary-button" href={refreshHref}>Reload page</a>
		<a class="secondary-button" href="/chat">Back to chat</a>
	</div>
</section>

<style>
	.briefing-status-card {
		max-width: 48rem;
		margin: 4rem auto;
		padding: 2rem;
		border-radius: 1.5rem;
		background:
			linear-gradient(160deg, rgba(255, 255, 255, 0.96), rgba(239, 246, 255, 0.94)),
			radial-gradient(circle at top right, rgba(14, 165, 233, 0.12), transparent 42%);
		border: 1px solid rgba(125, 211, 252, 0.34);
		box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
	}

	.briefing-status-kicker,
	.briefing-status-meta,
	.briefing-status-detail,
	.briefing-status-warning {
		color: rgba(51, 65, 85, 0.82);
	}

	.briefing-status-kicker {
		margin-bottom: 0.4rem;
		font-size: 0.85rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.briefing-status-card h1 {
		margin: 0 0 0.75rem;
		font-size: clamp(2rem, 3.4vw, 2.8rem);
	}

	.briefing-status-summary {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
		color: rgba(15, 23, 42, 0.92);
	}

	.briefing-status-detail {
		margin: 0.6rem 0 0;
		line-height: 1.6;
	}

	.briefing-progress-shell {
		margin-top: 1.35rem;
		padding: 1rem 1rem 1.15rem;
		border-radius: 1.1rem;
		background: rgba(255, 255, 255, 0.72);
		border: 1px solid rgba(186, 230, 253, 0.8);
	}

	.briefing-progress-header,
	.briefing-progress-meta,
	.briefing-status-note-row,
	.briefing-status-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		justify-content: space-between;
	}

	.briefing-progress-header {
		align-items: baseline;
		font-size: 0.95rem;
		font-weight: 600;
		color: rgba(15, 23, 42, 0.82);
	}

	.briefing-progress-header strong {
		font-size: 1rem;
		color: rgba(3, 105, 161, 0.96);
	}

	.briefing-progress-track {
		height: 0.9rem;
		margin-top: 0.75rem;
		border-radius: 999px;
		background: rgba(191, 219, 254, 0.55);
		overflow: hidden;
	}

	.briefing-progress-fill {
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, rgba(14, 165, 233, 0.92), rgba(59, 130, 246, 0.95));
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
		transition: width 0.45s ease;
	}

	.briefing-progress-meta {
		margin-top: 0.75rem;
		font-size: 0.9rem;
		color: rgba(51, 65, 85, 0.8);
	}

	.briefing-status-note-row {
		margin-top: 1rem;
	}

	.briefing-status-warning {
		margin-top: 1rem;
		padding: 0.85rem 1rem;
		border-radius: 0.9rem;
		background: rgba(255, 247, 237, 0.8);
		border: 1px solid rgba(251, 191, 36, 0.38);
	}

	.briefing-status-actions {
		margin-top: 1.5rem;
	}

	@media (max-width: 640px) {
		.briefing-status-card {
			padding: 1.4rem;
			margin-top: 2rem;
		}

		.briefing-progress-shell {
			padding: 0.9rem;
		}
	}
</style>