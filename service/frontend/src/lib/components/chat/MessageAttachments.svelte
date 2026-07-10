<script lang="ts">
	import { Download, Maximize2, Minimize2, Share2, X } from '@lucide/svelte';
	import AuthenticatedImage from '$lib/components/chat/AuthenticatedImage.svelte';
	import type { MessageAttachment } from '$lib/types-legacy';

	interface Props {
		attachments: MessageAttachment[];
	}

	let { attachments }: Props = $props();
	let selectedPreviewAttachment = $state<MessageAttachment | null>(null);
	let isPreviewAttachmentFullscreen = $state(false);
	let shareState = $state<Record<string, { shareId: string; isPublic: boolean; previewPath: string } | null>>({});
	let shareBusy = $state<string | null>(null);
	let shareNotice = $state<string | null>(null);
	let shareError = $state<string | null>(null);

	function formatAttachmentSize(sizeBytes: number) {
		return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
	}

	function isPreviewableAttachment(attachment: MessageAttachment) {
		return Boolean(attachment.previewUrl && (attachment.isHtml || attachment.isMarkdown));
	}

	function previewAttachmentLabel(attachment: MessageAttachment) {
		return attachment.isMarkdown ? 'Markdown' : 'HTML';
	}

	function openPreviewAttachment(attachment: MessageAttachment) {
		selectedPreviewAttachment = attachment;
		isPreviewAttachmentFullscreen = true;
		shareError = null;
		shareNotice = null;
	}

	function closePreviewAttachment() {
		selectedPreviewAttachment = null;
		isPreviewAttachmentFullscreen = false;
	}

	function togglePreviewAttachmentSize() {
		isPreviewAttachmentFullscreen = !isPreviewAttachmentFullscreen;
	}

	async function ensureShare(attachment: MessageAttachment) {
		if (shareState[attachment.id]) return;
		try {
			const response = await fetch(`/api/attachments/${encodeURIComponent(attachment.id)}/share`);
			if (response.ok) {
				const data = await response.json();
				shareState = { ...shareState, [attachment.id]: data };
			}
		} catch {
			// Share lookup failed silently
		}
	}

	async function toggleSharePublic(attachment: MessageAttachment) {
		const state = shareState[attachment.id];
		if (!state || shareBusy) return;

		shareBusy = attachment.id;
		shareError = null;
		shareNotice = null;

		const nextPublic = !state.isPublic;
		try {
			const response = await fetch(`/api/previews/${encodeURIComponent(state.shareId)}/sharing`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ isPublic: nextPublic })
			});

			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to update sharing.');
			}

			shareState = {
				...shareState,
				[attachment.id]: { ...state, isPublic: payload.isPublic === true, previewPath: payload.previewPath || state.previewPath }
			};
			shareNotice = nextPublic ? 'Preview link is now public.' : 'Preview link is now private.';
		} catch (err) {
			shareError = err instanceof Error ? err.message : 'Unable to update sharing.';
		} finally {
			shareBusy = null;
		}
	}

	async function copyShareLink(attachment: MessageAttachment) {
		const state = shareState[attachment.id];
		if (!state) return;

		shareError = null;
		shareNotice = null;
		const link = `${window.location.origin}${state.previewPath}`;

		try {
			await navigator.clipboard.writeText(link);
			shareNotice = 'Link copied.';
		} catch {
			shareNotice = link;
		}
	}

	function shareUrl(attachment: MessageAttachment, path: string) {
		return `${window.location.origin}${path}`;
	}
</script>

{#if attachments.length > 0}
	<div class="attachment-stack">
		{#each attachments as attachment}
			{#if isPreviewableAttachment(attachment)}
				<button
					class="attachment-card attachment-download attachment-preview-trigger"
					type="button"
					aria-haspopup="dialog"
					aria-label={`Open ${previewAttachmentLabel(attachment)} preview for ${attachment.fileName}`}
					onclick={() => { openPreviewAttachment(attachment); ensureShare(attachment); }}
				>
					<div class="attachment-card-main">
						<div class:attachment-markdown-chip={attachment.isMarkdown} class="attachment-html-chip" aria-hidden="true">
							{attachment.isMarkdown ? 'MD' : 'HTML'}
						</div>
						<div class="attachment-card-content">
							<div>{attachment.fileName}</div>
							<div class="message-meta">
								Preview in viewer · {attachment.contentType} · {formatAttachmentSize(attachment.sizeBytes)}
							</div>
						</div>
					</div>
					<span class="attachment-open-label">Open viewer</span>
				</button>
				{#if attachment.shareState}
					<button
						class="attachment-card attachment-share-trigger"
						type="button"
						aria-label={`Share ${previewAttachmentLabel(attachment)} preview for ${attachment.fileName}`}
						onclick={() => { openPreviewAttachment(attachment); ensureShare(attachment); }}
					>
						<div class="attachment-card-main">
							<Share2 class="h-4 w-4" aria-hidden="true" />
							<div class="attachment-card-content">
								<div>Share preview</div>
								<div class="message-meta">
									{attachment.shareState.isPublic ? 'Public — anyone with link' : 'Private — owner only'}
								</div>
							</div>
						</div>
						<span class="attachment-open-label">Share</span>
					</button>
				{/if}
			{:else if attachment.isAudio && attachment.downloadUrl}
				<div class="attachment-card attachment-card--audio">
					<div class="attachment-card-main">
						<div class="attachment-audio-chip" aria-hidden="true">Audio</div>
						<div class="attachment-card-content">
							<div>{attachment.fileName}</div>
							<div class="message-meta">
								{attachment.contentType} · {formatAttachmentSize(attachment.sizeBytes)}
							</div>
						</div>
					</div>
					<div class="attachment-audio-controls">
						<audio class="attachment-audio-player" controls preload="metadata">
							<source src={attachment.downloadUrl} type={attachment.contentType} />
							Your browser does not support inline audio playback.
						</audio>
						<div class="attachment-audio-actions">
							<a
								class="secondary-button attachment-audio-download-link"
								href={attachment.downloadUrl}
								download={attachment.fileName}
							>
								<Download class="h-3.5 w-3.5" aria-hidden="true" />
								<span>Download audio</span>
							</a>
						</div>
					</div>
				</div>
			{:else if attachment.downloadUrl}
				<a class="attachment-card attachment-download" href={attachment.downloadUrl} download={attachment.fileName}>
					<div class="attachment-card-main">
						{#if attachment.isImage}
							<AuthenticatedImage class="attachment-preview" src={attachment.downloadUrl} alt={attachment.fileName} />
						{/if}
						<div class="attachment-card-content">
							<div>{attachment.fileName}</div>
							<div class="message-meta">{attachment.contentType} · {formatAttachmentSize(attachment.sizeBytes)}</div>
						</div>
					</div>
					<Download class="attachment-download-icon" aria-hidden="true" />
				</a>
			{:else}
				<div class="attachment-card">
					<div>
						<div>{attachment.fileName}</div>
						<div class="message-meta">{attachment.contentType} · {formatAttachmentSize(attachment.sizeBytes)}</div>
					</div>
				</div>
			{/if}
		{/each}
	</div>
{/if}

{#if selectedPreviewAttachment}
	<div
		class="llama-attachment-modal-layer"
		role="presentation"
		onclick={(event: MouseEvent) => {
			if (event.currentTarget === event.target) {
				closePreviewAttachment();
			}
		}}
	>
		<div
			class:fullscreen={isPreviewAttachmentFullscreen}
			class="llama-attachment-modal"
			role="dialog"
			aria-modal="true"
			aria-label={`Preview ${selectedPreviewAttachment.fileName}`}
		>
			{#if isPreviewAttachmentFullscreen}
				<div class="llama-attachment-modal-floating-actions">
					<button
						class="secondary-button llama-attachment-modal-icon-button"
						type="button"
						aria-label="Switch to default modal size"
						onclick={togglePreviewAttachmentSize}
					>
						<Minimize2 class="h-4 w-4" aria-hidden="true" />
						<span class="visually-hidden">Default size</span>
					</button>

					<button
						class="secondary-button llama-attachment-modal-icon-button"
						type="button"
						aria-label="Close preview"
						onclick={closePreviewAttachment}
					>
						<X class="h-4 w-4" aria-hidden="true" />
						<span class="visually-hidden">Close preview</span>
					</button>
				</div>
			{/if}

			<header class="llama-attachment-modal-header">
				<div class="llama-attachment-modal-copy">
					<h2>{selectedPreviewAttachment.fileName}</h2>
					<div class="message-meta">
						{selectedPreviewAttachment.contentType} · {formatAttachmentSize(selectedPreviewAttachment.sizeBytes)}
					</div>
				</div>

				<div class="llama-attachment-modal-actions">
					{#if selectedPreviewAttachment.shareState}
						<button
							class="secondary-button"
							type="button"
							aria-label="Manage preview sharing"
							onclick={() => ensureShare(selectedPreviewAttachment)}
						>
							<Share2 class="h-3.5 w-3.5" aria-hidden="true" />
							<span>Share</span>
						</button>
					{/if}

					<button
						class="secondary-button"
						type="button"
						aria-label={isPreviewAttachmentFullscreen ? 'Switch to default modal size' : 'Switch to fullscreen modal size'}
						onclick={togglePreviewAttachmentSize}
					>
						{#if isPreviewAttachmentFullscreen}
							<Minimize2 class="h-3.5 w-3.5" aria-hidden="true" />
							<span>Default size</span>
						{:else}
							<Maximize2 class="h-3.5 w-3.5" aria-hidden="true" />
							<span>Fullscreen</span>
						{/if}
					</button>

					<button class="secondary-button" type="button" onclick={closePreviewAttachment}>Close</button>
				</div>
			</header>

			<div class="llama-attachment-modal-body">
				{#if selectedPreviewAttachment.previewUrl}
					<iframe
						class="llama-attachment-preview-frame"
						src={selectedPreviewAttachment.previewUrl}
						title={`${previewAttachmentLabel(selectedPreviewAttachment)} preview for ${selectedPreviewAttachment.fileName}`}
						sandbox=""
						loading="lazy"
					></iframe>
				{:else}
					<p class="llama-attachment-preview-empty">Preview unavailable for this attachment.</p>
				{/if}
			</div>

			<footer class="llama-attachment-modal-footer">
				<a
					class="secondary-button llama-attachment-download-link"
					href={selectedPreviewAttachment.downloadUrl}
					download={selectedPreviewAttachment.fileName}
				>
					<Download class="h-3.5 w-3.5" aria-hidden="true" />
					<span>Download {previewAttachmentLabel(selectedPreviewAttachment)}</span>
				</a>
			</footer>

			{#if selectedPreviewAttachment.shareState}
				<section class="llama-attachment-share-section" aria-label="Preview sharing controls">
					{#if shareNotice}
						<p class="llama-attachment-share-notice">{shareNotice}</p>
					{:else if shareError}
						<p class="llama-attachment-share-error">{shareError}</p>
					{/if}

					{#if shareState[selectedPreviewAttachment.id]}
						{@const state = shareState[selectedPreviewAttachment.id]}
							<div class="llama-attachment-share-status">
								<strong>{state.isPublic ? 'Preview is public' : 'Preview is private'}</strong>
								<p>{state.isPublic ? 'Anyone with this link can view the preview.' : 'Authentication is required until you make this preview public.'}</p>
							</div>
							<div class="llama-attachment-share-actions">
								<button
									class="secondary-button"
									type="button"
									onclick={() => toggleSharePublic(selectedPreviewAttachment)}
									disabled={shareBusy === selectedPreviewAttachment.id}
								>
									{#if shareBusy === selectedPreviewAttachment.id}
										Updating...
									{:else if state.isPublic}
										Make private
									{:else}
										Make public
									{/if}
								</button>
								{#if state.isPublic}
									<button
										class="secondary-button"
										type="button"
										onclick={() => copyShareLink(selectedPreviewAttachment)}
									>
										Copy link
									</button>
								{/if}
							</div>
							{#if state.isPublic}
								<a class="llama-attachment-share-link" href={shareUrl(selectedPreviewAttachment, state.previewPath)} target="_blank" rel="noopener noreferrer">
									{state.previewPath}
								</a>
							{/if}
					{:else}
						<button
							class="secondary-button"
							type="button"
							onclick={() => ensureShare(selectedPreviewAttachment)}
							disabled={shareBusy !== null}
						>
							{#if shareBusy}
								Creating share...
							{:else}
								Create share link
							{/if}
						</button>
					{/if}
				</section>
			{/if}
		</div>
	</div>
{/if}