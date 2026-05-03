<script lang="ts">
	import type { BriefingPreviewReady, BriefingTimelineCue } from '$lib/types/briefing';

	interface Props {
		briefing: BriefingPreviewReady;
	}

	let { briefing }: Props = $props();
	let audioElement = $state<HTMLAudioElement | null>(null);
	let currentTime = $state(0);
	let selectedSourceId = $state<string | null>(null);

	$effect(() => {
		const defaultSourceId = briefing.sources[0]?.id ?? null;
		if (!selectedSourceId) {
			selectedSourceId = defaultSourceId;
			return;
		}

		if (!briefing.sources.some((source) => source.id === selectedSourceId)) {
			selectedSourceId = defaultSourceId;
		}
	});

	function formatTime(seconds: number) {
		const totalSeconds = Math.max(0, Math.floor(seconds));
		const minutes = Math.floor(totalSeconds / 60);
		const remainder = totalSeconds % 60;
		return `${minutes}:${String(remainder).padStart(2, '0')}`;
	}

	function formatDate(value: string) {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
	}

	function updateCurrentTime() {
		currentTime = audioElement?.currentTime ?? 0;
	}

	function isCueActive(cue: BriefingTimelineCue | null | undefined) {
		return Boolean(cue) && currentTime >= cue.start && currentTime < cue.end;
	}

	function seekTo(seconds: number) {
		if (!audioElement) {
			return;
		}

		audioElement.currentTime = Math.max(0, seconds);
		currentTime = audioElement.currentTime;
		void audioElement.play().catch(() => {
			// Native controls remain available even if autoplay after seek is blocked.
		});
	}

	function selectSource(sourceId: string, cueStart?: number) {
		selectedSourceId = sourceId;
		if (typeof cueStart === 'number') {
			seekTo(cueStart);
		}
	}

	function isNestedInteractiveTarget(target: EventTarget | null) {
		return target instanceof HTMLElement && Boolean(target.closest('button, a, audio'));
	}

	function handleSectionCardClick(event: MouseEvent, sectionStart: number) {
		if (isNestedInteractiveTarget(event.target)) {
			return;
		}

		seekTo(sectionStart);
	}

	function sourceButtonLabel(title: string, publisher: string) {
		return publisher ? `${title} · ${publisher}` : title;
	}

	function sourceHrefLabel(title: string) {
		return `Open source ${title}`;
	}

	function audioDownloadName(assetPath: string) {
		const extension = assetPath.split('.').pop()?.trim();
		return extension ? `briefing-${briefing.jobId}.${extension}` : `briefing-${briefing.jobId}`;
	}

	const selectedSource = $derived(
		briefing.sources.find((source) => source.id === selectedSourceId) ?? briefing.sources[0] ?? null
	);

	const sourceCueStartById = $derived.by(() => {
		const cueStarts = new Map<string, number>();

		for (const section of briefing.sections) {
			for (const citation of section.citations) {
				if (!cueStarts.has(citation.sourceId)) {
					cueStarts.set(citation.sourceId, citation.cue?.start ?? section.start);
				}
			}
		}

		return cueStarts;
	});
</script>

<section class="briefing-player-shell">
	<header class="briefing-hero">
		<div class="briefing-hero-copy">
			<div class="briefing-hero-meta">
				<span class:invalid={!briefing.validation.valid} class="briefing-pill">
					{briefing.validation.valid ? 'Validated' : 'Needs review'}
				</span>
				<span class="briefing-meta-line">{briefing.generatedBy} · {briefing.locale}</span>
			</div>
			<h1>{briefing.title}</h1>
			<p class="briefing-topic">{briefing.topic}</p>
			{#if briefing.summary}
				<p class="briefing-summary">{briefing.summary}</p>
			{/if}
			<p class="briefing-generated-at">Generated {formatDate(briefing.generatedAt)}</p>
		</div>

		<div class="briefing-hero-actions">
			{#if briefing.exportHtmlAsset}
				<a class="secondary-button" href={briefing.exportHtmlAsset.url} target="_blank" rel="noreferrer">
					Open export HTML
				</a>
			{/if}
			{#if briefing.audioAsset}
				<a class="secondary-button" href={briefing.audioAsset.url} download={audioDownloadName(briefing.audioAsset.path)}>
					Download audio
				</a>
			{/if}
		</div>
	</header>

	{#if briefing.audioAsset}
		<div class="briefing-audio-card">
			<div>
				<div class="briefing-audio-label">Narration</div>
				<div class="briefing-audio-time">Current cue time {formatTime(currentTime)}</div>
			</div>
			<audio bind:this={audioElement} controls preload="metadata" ontimeupdate={updateCurrentTime} onseeked={updateCurrentTime} onloadedmetadata={updateCurrentTime}>
				<source src={briefing.audioAsset.url} type={briefing.audioAsset.contentType} />
				Your browser does not support inline audio playback.
			</audio>
		</div>
	{/if}

	<div class="briefing-layout">
		<div class="briefing-main-column">
			{#each briefing.sections as section}
				<section
					class:active={isCueActive(section.cue)}
					class="briefing-section-card"
					onclick={(event) => handleSectionCardClick(event, section.start)}
				>
					<div class="briefing-section-header">
						<button class="briefing-section-title" type="button" onclick={() => seekTo(section.start)}>
							<span>{section.title}</span>
							<span class="briefing-section-time">{formatTime(section.start)} - {formatTime(section.end)}</span>
						</button>
					</div>

					<div class="briefing-sentence-stack">
						{#each section.sentences as sentence}
							<button
								class:active={isCueActive(sentence.cue)}
								class="briefing-sentence"
								type="button"
								onclick={() => seekTo(sentence.start)}
							>
								<span>{sentence.text}</span>
								<span class="briefing-inline-time">{formatTime(sentence.start)}</span>
							</button>
						{/each}
					</div>

					{#if section.body.length > 0}
						<div class="briefing-body-copy">
							{#each section.body as paragraph}
								<p>{paragraph}</p>
							{/each}
						</div>
					{/if}

					{#if section.metrics.length > 0}
						<div class="briefing-metric-grid">
							{#each section.metrics as metric}
								<button
									class:active={isCueActive(metric.cue)}
									class="briefing-metric-card"
									type="button"
									onclick={() => seekTo(metric.cue?.start ?? section.start)}
								>
									<div class="briefing-metric-label">{metric.label}</div>
									<strong>{metric.value}</strong>
									{#if metric.trend}
										<span>{metric.trend}</span>
									{/if}
								</button>
							{/each}
						</div>
					{/if}

					{#if section.illustrations.length > 0}
						<div class="briefing-illustration-grid">
							{#each section.illustrations as illustration}
								<button
									class:active={isCueActive(illustration.cue)}
									class="briefing-illustration-card"
									type="button"
									onclick={() => seekTo(illustration.cue?.start ?? section.start)}
								>
									<div class="briefing-illustration-copy">
										<div class="briefing-illustration-title">{illustration.title}</div>
										<div class="briefing-illustration-caption">{illustration.caption}</div>
									</div>
									{#if illustration.asset}
										<img src={illustration.asset.url} alt={illustration.title} loading="lazy" />
									{/if}
								</button>
							{/each}
						</div>
					{/if}

					{#if section.citations.length > 0}
						<div class="briefing-citation-row">
							{#each section.citations as citation}
								<button
									class:active={isCueActive(citation.cue)}
									class="briefing-citation-chip"
									type="button"
									onclick={() => citation.source && selectSource(citation.source.id, citation.cue?.start)}
								>
									<span>{citation.label}</span>
									{#if citation.note}
										<small>{citation.note}</small>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</section>
			{/each}
		</div>

		<aside class="briefing-side-column">
			<section class="briefing-panel">
				<h2>Sources</h2>
				{#if briefing.sources.length === 0}
					<p class="briefing-panel-empty">No sources were attached to this briefing.</p>
				{:else}
					<div class="briefing-source-list">
						{#each briefing.sources as source}
							<button
								class:selected={source.id === selectedSource?.id}
								class="briefing-source-button"
								type="button"
								onclick={() => selectSource(source.id, sourceCueStartById.get(source.id))}
							>
								{sourceButtonLabel(source.title, source.publisher)}
							</button>
						{/each}
					</div>

					{#if selectedSource}
						<div class="briefing-source-detail">
							<h3>{selectedSource.title}</h3>
							<p class="briefing-source-publisher">{selectedSource.publisher}</p>
							{#if selectedSource.excerpt}
								<blockquote>{selectedSource.excerpt}</blockquote>
							{/if}
							<a href={selectedSource.url} target="_blank" rel="noreferrer" aria-label={sourceHrefLabel(selectedSource.title)}>
								Open source
							</a>
						</div>
					{/if}
				{/if}
			</section>

			<section class="briefing-panel">
				<h2>Validation</h2>
				<p class="briefing-validation-state">
					{briefing.validation.valid ? 'All renderer validations passed.' : 'Renderer flagged issues for review.'}
				</p>
				{#if briefing.validation.warnings.length > 0}
					<ul>
						{#each briefing.validation.warnings as warning}
							<li>{warning}</li>
						{/each}
					</ul>
				{/if}
				{#if briefing.validation.errors.length > 0}
					<ul class="briefing-error-list">
						{#each briefing.validation.errors as errorText}
							<li>{errorText}</li>
						{/each}
					</ul>
				{/if}
			</section>
		</aside>
	</div>
</section>

<style>
	.briefing-player-shell {
		display: grid;
		gap: 1.5rem;
	}

	.briefing-hero,
	.briefing-audio-card,
	.briefing-section-card,
	.briefing-panel {
		border: 1px solid rgba(148, 163, 184, 0.25);
		border-radius: 1.5rem;
		background: rgba(255, 255, 255, 0.92);
		box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08);
	}

	.briefing-hero {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.75rem;
		background:
			radial-gradient(circle at top left, rgba(14, 116, 144, 0.12), transparent 40%),
			radial-gradient(circle at bottom right, rgba(15, 118, 110, 0.1), transparent 42%),
			rgba(255, 255, 255, 0.94);
	}

	.briefing-hero-copy h1 {
		margin: 0.4rem 0 0;
		font-size: clamp(2rem, 4vw, 3rem);
		line-height: 1.05;
	}

	.briefing-topic,
	.briefing-summary,
	.briefing-generated-at,
	.briefing-panel-empty,
	.briefing-validation-state,
	.briefing-source-publisher,
	.briefing-illustration-caption,
	.briefing-inline-time,
	.briefing-section-time,
	.briefing-audio-time,
	.briefing-meta-line {
		color: rgba(51, 65, 85, 0.8);
	}

	.briefing-topic {
		font-size: 1.05rem;
		margin: 0.65rem 0 0;
	}

	.briefing-summary {
		max-width: 68ch;
	}

	.briefing-generated-at {
		margin-bottom: 0;
	}

	.briefing-hero-meta {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		align-items: center;
	}

	.briefing-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.35rem 0.8rem;
		border-radius: 999px;
		background: rgba(13, 148, 136, 0.16);
		color: rgb(15, 118, 110);
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.briefing-pill.invalid {
		background: rgba(220, 38, 38, 0.14);
		color: rgb(185, 28, 28);
	}

	.briefing-hero-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		align-items: flex-start;
	}

	.briefing-audio-card {
		padding: 1.25rem 1.5rem;
		display: grid;
		gap: 0.75rem;
	}

	.briefing-audio-label {
		font-weight: 700;
	}

	.briefing-audio-card audio {
		width: 100%;
	}

	.briefing-layout {
		display: grid;
		gap: 1.5rem;
		grid-template-columns: minmax(0, 2fr) minmax(18rem, 0.95fr);
	}

	.briefing-main-column,
	.briefing-side-column {
		display: grid;
		gap: 1rem;
		align-content: start;
	}

	.briefing-section-card {
		padding: 1.35rem;
		display: grid;
		gap: 1rem;
		cursor: pointer;
		transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
	}

	.briefing-section-card.active,
	.briefing-sentence.active,
	.briefing-metric-card.active,
	.briefing-illustration-card.active,
	.briefing-citation-chip.active,
	.briefing-source-button.selected {
		border-color: rgba(14, 116, 144, 0.42);
		box-shadow: 0 14px 34px rgba(14, 116, 144, 0.12);
	}

	.briefing-section-title,
	.briefing-sentence,
	.briefing-metric-card,
	.briefing-illustration-card,
	.briefing-citation-chip,
	.briefing-source-button {
		width: 100%;
		border: 1px solid rgba(148, 163, 184, 0.28);
		background: rgba(248, 250, 252, 0.92);
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.briefing-section-title {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: baseline;
		padding: 0;
		border: 0;
		background: transparent;
		font-size: 1.2rem;
		font-weight: 800;
	}

	.briefing-sentence-stack,
	.briefing-body-copy,
	.briefing-citation-row,
	.briefing-source-list {
		display: grid;
		gap: 0.75rem;
	}

	.briefing-sentence {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
		padding: 0.9rem 1rem;
		border-radius: 1rem;
	}

	.briefing-inline-time,
	.briefing-section-time {
		font-size: 0.82rem;
		white-space: nowrap;
	}

	.briefing-body-copy p {
		margin: 0;
	}

	.briefing-metric-grid,
	.briefing-illustration-grid {
		display: grid;
		gap: 0.85rem;
	}

	.briefing-metric-grid {
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
	}

	.briefing-metric-card,
	.briefing-illustration-card,
	.briefing-panel,
	.briefing-citation-chip,
	.briefing-source-button {
		border-radius: 1rem;
	}

	.briefing-metric-card,
	.briefing-illustration-card {
		padding: 1rem;
		display: grid;
		gap: 0.45rem;
	}

	.briefing-metric-label,
	.briefing-illustration-title {
		font-size: 0.92rem;
		font-weight: 700;
	}

	.briefing-metric-card strong {
		font-size: 1.6rem;
	}

	.briefing-illustration-card img {
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: 0.9rem;
		border: 1px solid rgba(148, 163, 184, 0.18);
	}

	.briefing-citation-row {
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
	}

	.briefing-citation-chip,
	.briefing-source-button {
		padding: 0.85rem 1rem;
	}

	.briefing-citation-chip small {
		display: block;
		margin-top: 0.25rem;
		color: rgba(51, 65, 85, 0.72);
	}

	.briefing-panel {
		padding: 1.15rem;
	}

	.briefing-panel h2,
	.briefing-source-detail h3 {
		margin-top: 0;
	}

	.briefing-source-detail {
		margin-top: 1rem;
		display: grid;
		gap: 0.65rem;
	}

	.briefing-source-detail blockquote {
		margin: 0;
		padding-left: 0.9rem;
		border-left: 3px solid rgba(14, 116, 144, 0.3);
		color: rgba(30, 41, 59, 0.9);
	}

	.briefing-error-list {
		color: rgb(185, 28, 28);
	}

	@media (max-width: 960px) {
		.briefing-layout {
			grid-template-columns: 1fr;
		}

		.briefing-hero {
			display: grid;
		}
	}
</style>
