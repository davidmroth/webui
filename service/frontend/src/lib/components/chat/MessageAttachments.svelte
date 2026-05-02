<script lang="ts">
	import { Download, Maximize2, Minimize2, X } from '@lucide/svelte';
	import type { MessageAttachment } from '$lib/types-legacy';

	interface Props {
		attachments: MessageAttachment[];
	}

	let { attachments }: Props = $props();
	let selectedHtmlAttachment = $state<MessageAttachment | null>(null);
	let isHtmlAttachmentFullscreen = $state(false);

	function formatAttachmentSize(sizeBytes: number) {
		return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
	}

	function openHtmlAttachment(attachment: MessageAttachment) {
		selectedHtmlAttachment = attachment;
		isHtmlAttachmentFullscreen = true;
	}

	function closeHtmlAttachment() {
		selectedHtmlAttachment = null;
		isHtmlAttachmentFullscreen = false;
	}

	function toggleHtmlAttachmentSize() {
		isHtmlAttachmentFullscreen = !isHtmlAttachmentFullscreen;
	}
</script>

{#if attachments.length > 0}
	<div class="attachment-stack">
		{#each attachments as attachment}
			{#if attachment.isHtml && attachment.previewUrl}
				<button
					class="attachment-card attachment-download attachment-preview-trigger"
					type="button"
					aria-haspopup="dialog"
					aria-label={`Open HTML preview for ${attachment.fileName}`}
					onclick={() => openHtmlAttachment(attachment)}
				>
					<div class="attachment-card-main">
						<div class="attachment-html-chip" aria-hidden="true">HTML</div>
						<div class="attachment-card-content">
							<div>{attachment.fileName}</div>
							<div class="message-meta">
								Preview in modal · {attachment.contentType} · {formatAttachmentSize(attachment.sizeBytes)}
							</div>
						</div>
					</div>
					<span class="attachment-open-label">Open preview</span>
				</button>
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
							<img class="attachment-preview" src={attachment.downloadUrl} alt={attachment.fileName} />
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

{#if selectedHtmlAttachment}
	<div
		class="llama-attachment-modal-layer"
		role="presentation"
		onclick={(event: MouseEvent) => {
			if (event.currentTarget === event.target) {
				closeHtmlAttachment();
			}
		}}
	>
		<div
			class:fullscreen={isHtmlAttachmentFullscreen}
			class="llama-attachment-modal"
			role="dialog"
			aria-modal="true"
			aria-label={`Preview ${selectedHtmlAttachment.fileName}`}
		>
			{#if isHtmlAttachmentFullscreen}
				<div class="llama-attachment-modal-floating-actions">
					<button
						class="secondary-button llama-attachment-modal-icon-button"
						type="button"
						aria-label="Switch to default modal size"
						onclick={toggleHtmlAttachmentSize}
					>
						<Minimize2 class="h-4 w-4" aria-hidden="true" />
						<span class="visually-hidden">Default size</span>
					</button>

					<button
						class="secondary-button llama-attachment-modal-icon-button"
						type="button"
						aria-label="Close HTML preview"
						onclick={closeHtmlAttachment}
					>
						<X class="h-4 w-4" aria-hidden="true" />
						<span class="visually-hidden">Close preview</span>
					</button>
				</div>
			{/if}

			<header class="llama-attachment-modal-header">
				<div class="llama-attachment-modal-copy">
					<h2>{selectedHtmlAttachment.fileName}</h2>
					<div class="message-meta">
						{selectedHtmlAttachment.contentType} · {formatAttachmentSize(selectedHtmlAttachment.sizeBytes)}
					</div>
				</div>

				<div class="llama-attachment-modal-actions">
					<button
						class="secondary-button"
						type="button"
						aria-label={isHtmlAttachmentFullscreen ? 'Switch to default modal size' : 'Switch to fullscreen modal size'}
						onclick={toggleHtmlAttachmentSize}
					>
						{#if isHtmlAttachmentFullscreen}
							<Minimize2 class="h-3.5 w-3.5" aria-hidden="true" />
							<span>Default size</span>
						{:else}
							<Maximize2 class="h-3.5 w-3.5" aria-hidden="true" />
							<span>Fullscreen</span>
						{/if}
					</button>

					<button class="secondary-button" type="button" onclick={closeHtmlAttachment}>Close</button>
				</div>
			</header>

			<div class="llama-attachment-modal-body">
				{#if selectedHtmlAttachment.previewUrl}
					<iframe
						class="llama-attachment-preview-frame"
						src={selectedHtmlAttachment.previewUrl}
						title={`HTML preview for ${selectedHtmlAttachment.fileName}`}
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
					href={selectedHtmlAttachment.downloadUrl}
					download={selectedHtmlAttachment.fileName}
				>
					<Download class="h-3.5 w-3.5" aria-hidden="true" />
					<span>Download HTML</span>
				</a>
			</footer>
		</div>
	</div>
{/if}