function encodeAssetPath(assetPath: string) {
	return assetPath
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');
}

function buildAssetUrl(jobId: string, assetPath: string) {
	return `/api/briefings/${encodeURIComponent(jobId)}/assets/${encodeAssetPath(assetPath)}`;
}

interface StandaloneManagementOptions {
	canManage: boolean;
	isPublic: boolean;
	standalonePath: string;
}

function escapeAttribute(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

function buildManagementBar(jobId: string, options: StandaloneManagementOptions) {
	const buttonLabel = options.isPublic ? 'Make standalone private' : 'Make standalone public';
	const statusLabel = options.isPublic ? 'Standalone HTML is public' : 'Standalone HTML is private';
	const statusDescription = options.isPublic
		? 'Anyone with this standalone link can open it.'
		: 'Authentication is required until you explicitly make this standalone export public.';

	return `
<aside id="briefing-share-manager" data-job-id="${escapeAttribute(jobId)}" data-public="${options.isPublic ? 'true' : 'false'}" data-standalone-path="${escapeAttribute(options.standalonePath)}">
	<style>
		#briefing-share-manager {
			position: sticky;
			top: 0;
			z-index: 9999;
			display: grid;
			gap: 0.75rem;
			padding: 0.9rem 1rem;
			margin: 0;
			border-bottom: 1px solid rgba(15, 23, 42, 0.08);
			background: rgba(255, 252, 247, 0.96);
			backdrop-filter: blur(14px);
			-webkit-backdrop-filter: blur(14px);
			box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
			font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
			color: #1f2937;
		}
		#briefing-share-manager .share-manager-copy {
			display: grid;
			gap: 0.2rem;
		}
		#briefing-share-manager .share-manager-kicker {
			font-size: 0.72rem;
			font-weight: 700;
			letter-spacing: 0.12em;
			text-transform: uppercase;
			color: #0f766e;
		}
		#briefing-share-manager .share-manager-status {
			font-size: 1rem;
			font-weight: 700;
		}
		#briefing-share-manager .share-manager-detail {
			font-size: 0.92rem;
			line-height: 1.45;
			color: #4b5563;
		}
		#briefing-share-manager .share-manager-actions {
			display: flex;
			flex-wrap: wrap;
			gap: 0.75rem;
		}
		#briefing-share-manager button {
			appearance: none;
			border: 0;
			border-radius: 999px;
			padding: 0.8rem 1rem;
			font-size: 0.95rem;
			font-weight: 600;
			cursor: pointer;
			background: #111827;
			color: #fff;
		}
		#briefing-share-manager button.secondary {
			background: #e5e7eb;
			color: #111827;
		}
		#briefing-share-manager button[disabled] {
			opacity: 0.6;
			cursor: wait;
		}
		#briefing-share-manager .share-manager-message {
			font-size: 0.88rem;
			line-height: 1.4;
			color: #0f766e;
			word-break: break-word;
		}
		#briefing-share-manager .share-manager-message.error {
			color: #b91c1c;
		}
		@media (max-width: 640px) {
			#briefing-share-manager .share-manager-actions {
				flex-direction: column;
			}
			#briefing-share-manager button {
				width: 100%;
			}
		}
	</style>
	<div class="share-manager-copy">
		<div class="share-manager-kicker">Standalone access</div>
		<div class="share-manager-status">${statusLabel}</div>
		<div class="share-manager-detail">${statusDescription}</div>
	</div>
	<div class="share-manager-actions">
		<button type="button" id="share-toggle-button">${buttonLabel}</button>
		<button type="button" id="share-copy-button" class="secondary">Copy standalone link</button>
	</div>
	<div id="share-manager-message" class="share-manager-message" aria-live="polite"></div>
	<script>
		(() => {
			const root = document.getElementById('briefing-share-manager');
			if (!root) return;
			const toggleButton = document.getElementById('share-toggle-button');
			const copyButton = document.getElementById('share-copy-button');
			const message = document.getElementById('share-manager-message');
			const standalonePath = root.dataset.standalonePath || window.location.pathname;
			const jobId = root.dataset.jobId || '';
			let isPublic = root.dataset.public === 'true';
			const setMessage = (text, isError = false) => {
				if (!message) return;
				message.textContent = text;
				message.className = isError ? 'share-manager-message error' : 'share-manager-message';
			};
			const setState = (nextPublic, busy = false) => {
				isPublic = nextPublic;
				root.dataset.public = nextPublic ? 'true' : 'false';
				if (toggleButton) {
					toggleButton.disabled = busy;
					toggleButton.textContent = busy
						? 'Updating...'
						: nextPublic
							? 'Make standalone private'
							: 'Make standalone public';
				}
				const status = root.querySelector('.share-manager-status');
				const detail = root.querySelector('.share-manager-detail');
				if (status) status.textContent = nextPublic ? 'Standalone HTML is public' : 'Standalone HTML is private';
				if (detail) detail.textContent = nextPublic
					? 'Anyone with this standalone link can open it.'
					: 'Authentication is required until you explicitly make this standalone export public.';
			};
			toggleButton?.addEventListener('click', async () => {
				setMessage('');
				setState(isPublic, true);
				const nextPublic = !isPublic;
				try {
					const response = await fetch('/api/briefings/' + encodeURIComponent(jobId) + '/sharing', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ isPublic: nextPublic })
					});
					const payload = await response.json().catch(() => ({}));
					if (!response.ok) {
						throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to update standalone sharing.');
					}
					setState(payload.isPublic === true, false);
					setMessage(payload.isPublic === true ? 'Standalone HTML access enabled.' : 'Standalone HTML access disabled.');
				} catch (error) {
					setState(isPublic, false);
					setMessage(error instanceof Error ? error.message : 'Unable to update standalone sharing.', true);
				}
			});
			copyButton?.addEventListener('click', async () => {
				const link = new URL(standalonePath, window.location.origin).toString();
				try {
					await navigator.clipboard.writeText(link);
					setMessage('Standalone link copied.');
				} catch {
					setMessage(link);
				}
			});
		})();
	</script>
</aside>`;
}

function injectManagementBar(html: string, jobId: string, options?: StandaloneManagementOptions) {
	if (!options?.canManage) {
		return html;
	}

	const managementBar = buildManagementBar(jobId, options);
	if (/<body[^>]*>/i.test(html)) {
		return html.replace(/<body([^>]*)>/i, `<body$1>${managementBar}`);
	}

	return `${managementBar}${html}`;
}

export function rewriteStandaloneAssetUrls(html: string, jobId: string, options?: StandaloneManagementOptions) {
	const rewritten = html
		.replaceAll('./player.css', buildAssetUrl(jobId, 'player.css'))
		.replaceAll('./audio.mp3', buildAssetUrl(jobId, 'audio.mp3'))
		.replaceAll('./player.js', buildAssetUrl(jobId, 'player.js'))
		.replaceAll(/\.\/illustrations\/([^"'?#>]+)/g, (_match, assetName: string) => {
			return buildAssetUrl(jobId, `illustrations/${assetName}`);
		});

	return injectManagementBar(rewritten, jobId, options);
}