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
	const buttonLabel = options.isPublic ? 'Make private' : 'Make public';
	const statusLabel = options.isPublic ? 'HTML export is public' : 'HTML export is private';
	const statusDescription = options.isPublic
		? 'Anyone with this link can open it.'
		: 'Authentication is required until you explicitly make this export public.';

	return `
<aside id="briefing-share-manager" data-job-id="${escapeAttribute(jobId)}" data-public="${options.isPublic ? 'true' : 'false'}" data-standalone-path="${escapeAttribute(options.standalonePath)}">
	<style>
		#briefing-share-manager {
			position: fixed;
			right: 1rem;
			bottom: 1rem;
			z-index: 9999;
			font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
			color: #1f2937;
		}
		#briefing-share-manager[hidden] {
			display: none;
		}
		#briefing-share-launcher {
			appearance: none;
			border: 0;
			border-radius: 999px;
			padding: 0.85rem 1rem;
			font-size: 0.95rem;
			font-weight: 700;
			cursor: pointer;
			background: rgba(17, 24, 39, 0.94);
			color: #fff;
			box-shadow: 0 18px 42px rgba(15, 23, 42, 0.22);
			backdrop-filter: blur(14px);
			-webkit-backdrop-filter: blur(14px);
		}
		#briefing-share-dialog {
			position: fixed;
			inset: 0;
			display: none;
			align-items: flex-end;
			justify-content: flex-end;
			padding: 1rem;
			background: rgba(15, 23, 42, 0.16);
		}
		#briefing-share-dialog[data-open="true"] {
			display: flex;
		}
		#briefing-share-panel {
			width: min(28rem, calc(100vw - 2rem));
			display: grid;
			gap: 0.75rem;
			padding: 1rem;
			margin: 0;
			border: 1px solid rgba(15, 23, 42, 0.08);
			border-radius: 1.25rem;
			background: rgba(255, 252, 247, 0.98);
			backdrop-filter: blur(14px);
			-webkit-backdrop-filter: blur(14px);
			box-shadow: 0 24px 54px rgba(15, 23, 42, 0.18);
		}
		#briefing-share-panel-header {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			gap: 0.75rem;
		}
		#briefing-share-close {
			appearance: none;
			border: 0;
			border-radius: 999px;
			width: 2.25rem;
			height: 2.25rem;
			padding: 0;
			font-size: 1.25rem;
			line-height: 1;
			cursor: pointer;
			background: #e5e7eb;
			color: #111827;
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
		#briefing-share-manager .share-manager-actions button {
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
		#briefing-share-manager .share-manager-actions button.secondary {
			background: #e5e7eb;
			color: #111827;
		}
		#briefing-share-manager .share-manager-actions button[disabled] {
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
			#briefing-share-manager {
				right: 0.75rem;
				bottom: 0.75rem;
			}
			#briefing-share-dialog {
				align-items: flex-end;
				justify-content: stretch;
				padding: 0.75rem;
			}
			#briefing-share-panel {
				width: 100%;
				max-height: min(32rem, calc(100vh - 1.5rem));
				overflow: auto;
			}
			#briefing-share-manager .share-manager-actions {
				flex-direction: column;
			}
			#briefing-share-manager .share-manager-actions button,
			#briefing-share-launcher {
				width: 100%;
			}
		}
	</style>
	<button type="button" id="briefing-share-launcher" aria-haspopup="dialog" aria-expanded="false">Manage access</button>
	<div id="briefing-share-dialog" aria-hidden="true">
		<section id="briefing-share-panel" role="dialog" aria-modal="true" aria-labelledby="briefing-share-title">
			<div id="briefing-share-panel-header">
				<div class="share-manager-copy">
					<div class="share-manager-kicker">Access</div>
					<div class="share-manager-status" id="briefing-share-title">${statusLabel}</div>
					<div class="share-manager-detail">${statusDescription}</div>
				</div>
				<button type="button" id="briefing-share-close" aria-label="Close access panel">×</button>
			</div>
			<div class="share-manager-actions">
				<button type="button" id="share-toggle-button">${buttonLabel}</button>
				<button type="button" id="share-copy-button" class="secondary">Copy link</button>
			</div>
			<div id="share-manager-message" class="share-manager-message" aria-live="polite"></div>
		</section>
	</div>
	<script>
		(() => {
			const root = document.getElementById('briefing-share-manager');
			if (!root) return;
			const launcher = document.getElementById('briefing-share-launcher');
			const dialog = document.getElementById('briefing-share-dialog');
			const panel = document.getElementById('briefing-share-panel');
			const closeButton = document.getElementById('briefing-share-close');
			const toggleButton = document.getElementById('share-toggle-button');
			const copyButton = document.getElementById('share-copy-button');
			const message = document.getElementById('share-manager-message');
			const standalonePath = root.dataset.standalonePath || window.location.pathname;
			const jobId = root.dataset.jobId || '';
			let isPublic = root.dataset.public === 'true';
			const setOpen = (open) => {
				if (!dialog || !launcher) return;
				dialog.dataset.open = open ? 'true' : 'false';
				dialog.setAttribute('aria-hidden', open ? 'false' : 'true');
				launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
				if (open) {
					toggleButton?.focus();
				} else {
					launcher.focus();
				}
			};
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
							? 'Make private'
							: 'Make public';
				}
				const status = root.querySelector('.share-manager-status');
				const detail = root.querySelector('.share-manager-detail');
				if (status) status.textContent = nextPublic ? 'HTML export is public' : 'HTML export is private';
				if (detail) detail.textContent = nextPublic
					? 'Anyone with this link can open it.'
					: 'Authentication is required until you explicitly make this export public.';
			};
			launcher?.addEventListener('click', () => setOpen(true));
			closeButton?.addEventListener('click', () => setOpen(false));
			dialog?.addEventListener('click', (event) => {
				if (event.target === dialog) {
					setOpen(false);
				}
			});
			document.addEventListener('keydown', (event) => {
				if (event.key === 'Escape' && dialog?.dataset.open === 'true') {
					setOpen(false);
				}
			});
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
						throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to update access.');
					}
					setState(payload.isPublic === true, false);
					setMessage(payload.isPublic === true ? 'Access enabled.' : 'Access disabled.');
				} catch (error) {
					setState(isPublic, false);
					setMessage(error instanceof Error ? error.message : 'Unable to update access.', true);
				}
			});
			copyButton?.addEventListener('click', async () => {
				const link = new URL(standalonePath, window.location.origin).toString();
				try {
					await navigator.clipboard.writeText(link);
					setMessage('Link copied.');
				} catch {
					setMessage(link);
				}
			});
			setOpen(false);
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

function buildStandalonePlayerDock() {
	return `
<style id="webui-standalone-player-dock">
	.hero-audio.webui-docked-player[data-webui-placement="rail"] {
		margin-top: 0;
		padding-top: 0;
		border-top: 0;
	}

	.article-rail > .hero-audio.webui-docked-player[data-webui-placement="rail"] {
		order: -1;
		margin-bottom: 0.25rem;
	}

	.hero-audio.webui-docked-player[data-webui-placement="rail"] .hero-audio-player {
		padding: 1rem 1.1rem;
		border-radius: 1.4rem;
		border: 1px solid rgba(82, 62, 39, 0.12);
		background: rgba(255, 252, 247, 0.94);
		box-shadow: 0 18px 40px rgba(63, 45, 24, 0.16);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
	}

	.hero-audio.webui-docked-player[data-webui-placement="hero"] .hero-audio-player {
		padding: 1.1rem 1.2rem;
		border-radius: 1.7rem;
		border: 1px solid rgba(82, 62, 39, 0.1);
		background: rgba(255, 252, 247, 0.96);
		box-shadow: 0 20px 48px rgba(63, 45, 24, 0.12);
	}

	.hero-audio.webui-docked-player .hero-audio-label {
		margin-bottom: 0;
	}

	.hero-audio.webui-docked-player[data-webui-placement="hero"] .hero-audio-label {
		margin-bottom: 10px;
	}

	.hero-audio.webui-docked-player .webui-narration-toolbar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.75rem;
		align-items: center;
		margin-top: 0.65rem;
	}

	.hero-audio.webui-docked-player[data-webui-placement="hero"] .webui-narration-toolbar {
		margin-top: 0;
		margin-bottom: 0.75rem;
	}

	.hero-audio.webui-docked-player .webui-narration-status {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		font: 500 0.92rem/1.4 var(--font-sans, system-ui, sans-serif);
		color: var(--muted, rgba(82, 62, 39, 0.7));
	}

	.hero-audio.webui-docked-player .webui-narration-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	.hero-audio.webui-docked-player .webui-narration-actions button {
		appearance: none;
		border: 1px solid rgba(82, 62, 39, 0.14);
		border-radius: 999px;
		padding: 0.7rem 0.95rem;
		font: 600 0.92rem/1 var(--font-sans, system-ui, sans-serif);
		cursor: pointer;
		background: rgba(255, 255, 255, 0.92);
		color: var(--ink, #22190f);
	}

	.hero-audio.webui-docked-player .webui-narration-actions button:hover {
		border-color: rgba(138, 67, 21, 0.24);
		background: rgba(255, 255, 255, 1);
	}

	.hero-audio.webui-docked-player[data-webui-expanded="false"] audio {
		display: none;
	}

	.hero-audio.webui-docked-player[data-webui-expanded="true"] audio {
		display: block;
		margin-top: 0.75rem;
	}

	.hero-audio.webui-docked-player.is-sticky .hero-audio-player {
		position: static;
		top: auto;
		left: auto;
		width: auto;
		max-width: none;
	}

	.hero-audio.webui-docked-player[data-webui-placement="hero"] {
		margin-top: 22px;
		padding-top: 0;
		border-top: 0;
	}

	.hero-audio.webui-docked-player[data-webui-placement="hero"] .hero-audio-player {
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
	}

	@media (max-width: 960px) {
		.hero-audio.webui-docked-player .webui-narration-toolbar {
			grid-template-columns: 1fr;
		}

		.hero-audio.webui-docked-player .webui-narration-actions {
			justify-content: stretch;
		}

		.hero-audio.webui-docked-player .webui-narration-actions button {
			width: 100%;
		}
	}
</style>
<script>
	(() => {
		const stickyPlayer = document.querySelector('[data-sticky-player]');
		const hero = document.querySelector('.hero');
		const rail = document.querySelector('.article-rail');
		const playerBox = stickyPlayer instanceof HTMLElement ? stickyPlayer.querySelector('.hero-audio-player') : null;
		const audio = stickyPlayer instanceof HTMLElement ? stickyPlayer.querySelector('[data-briefing-audio]') : null;

		if (!(stickyPlayer instanceof HTMLElement) || !(hero instanceof HTMLElement) || !(rail instanceof HTMLElement) || !(playerBox instanceof HTMLElement) || !(audio instanceof HTMLAudioElement)) {
			return;
		}

		stickyPlayer.classList.add('webui-docked-player');

		const breakpoint = window.matchMedia('(max-width: 960px)');
		const anchor = document.createComment('webui-standalone-player-anchor');
		const parent = stickyPlayer.parentNode;
		if (parent) {
			parent.insertBefore(anchor, stickyPlayer);
		}

		const toolbar = document.createElement('div');
		toolbar.className = 'webui-narration-toolbar';

		const status = document.createElement('div');
		status.className = 'webui-narration-status';

		const stateLabel = document.createElement('span');
		const separator = document.createElement('span');
		separator.setAttribute('aria-hidden', 'true');
		separator.textContent = '·';
		const cueLabel = document.createElement('span');

		status.append(stateLabel, separator, cueLabel);

		const actions = document.createElement('div');
		actions.className = 'webui-narration-actions';

		const playButton = document.createElement('button');
		playButton.type = 'button';

		const expandButton = document.createElement('button');
		expandButton.type = 'button';
		expandButton.setAttribute('aria-expanded', 'false');

		actions.append(playButton, expandButton);
		toolbar.append(status, actions);

		const label = playerBox.querySelector('.hero-audio-label');
		if (label instanceof HTMLElement) {
			label.insertAdjacentElement('afterend', toolbar);
		} else {
			playerBox.insertBefore(toolbar, audio);
		}

		let preferencePinned = false;
		let isExpanded = false;

		function setPlacement(nextPlacement) {
			stickyPlayer.dataset.webuiPlacement = nextPlacement;
			if (nextPlacement === 'hero') {
				if (anchor.parentNode) {
					anchor.parentNode.insertBefore(stickyPlayer, anchor.nextSibling);
				}
				return;
			}

			if (rail.firstChild) {
				rail.insertBefore(stickyPlayer, rail.firstChild);
			} else {
				rail.appendChild(stickyPlayer);
			}
		}

		function formatTime(seconds) {
			const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
			const minutes = Math.floor(safeSeconds / 60);
			const remainder = safeSeconds % 60;
			return minutes + ':' + String(remainder).padStart(2, '0');
		}

		function syncPlaybackState() {
			stateLabel.textContent = audio.paused ? 'Ready' : 'Playing';
			cueLabel.textContent = 'Current cue ' + formatTime(audio.currentTime || 0);
			playButton.textContent = audio.paused ? 'Play' : 'Pause';
		}

		function setExpanded(nextExpanded) {
			isExpanded = nextExpanded;
			stickyPlayer.dataset.webuiExpanded = nextExpanded ? 'true' : 'false';
			expandButton.textContent = nextExpanded ? 'Collapse' : 'Expand';
			expandButton.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
			setPlacement(breakpoint.matches || nextExpanded ? 'hero' : 'rail');
		}

		function dockForViewport() {
			const isInline = breakpoint.matches;
			stickyPlayer.dataset.webuiInline = isInline ? 'true' : 'false';

			if (!preferencePinned) {
				setExpanded(true);
			} else {
				setPlacement(isInline || isExpanded ? 'hero' : 'rail');
			}
		}

		function resolveCueTarget(startNode) {
			if (!(startNode instanceof Element)) {
				return null;
			}

			const directTarget = startNode.closest('[data-start][data-end]');
			if (directTarget instanceof HTMLElement) {
				return directTarget;
			}

			const sectionCard = startNode.closest('.section-card');
			return sectionCard instanceof HTMLElement ? sectionCard : null;
		}

		function handleDelegatedCueSeek(event) {
			const target = resolveCueTarget(event.target);
			if (!(target instanceof HTMLElement)) {
				return;
			}

			if (event.target instanceof Element && event.target.closest('a[href]')) {
				return;
			}

			const cueStart = Number.parseFloat(target.dataset.start || 'NaN');
			if (!Number.isFinite(cueStart)) {
				return;
			}

			event.preventDefault();
			event.stopImmediatePropagation();
			audio.currentTime = cueStart;
			void audio.play().catch(() => {});
		}

		playButton.addEventListener('click', async () => {
			if (audio.paused) {
				await audio.play().catch(() => {});
				return;
			}

			audio.pause();
		});

		expandButton.addEventListener('click', () => {
			preferencePinned = true;
			setExpanded(!isExpanded);
		});

		audio.addEventListener('timeupdate', syncPlaybackState);
		audio.addEventListener('seeked', syncPlaybackState);
		audio.addEventListener('loadedmetadata', syncPlaybackState);
		audio.addEventListener('play', () => {
			syncPlaybackState();
			if (!breakpoint.matches && !preferencePinned) {
				setExpanded(false);
			}
		});
		audio.addEventListener('pause', syncPlaybackState);
		audio.addEventListener('ended', syncPlaybackState);
		document.addEventListener('click', handleDelegatedCueSeek, true);

		if (typeof breakpoint.addEventListener === 'function') {
			breakpoint.addEventListener('change', dockForViewport);
		} else if (typeof breakpoint.addListener === 'function') {
			breakpoint.addListener(dockForViewport);
		}

		dockForViewport();
		syncPlaybackState();
	})();
</script>`;
}

function injectStandalonePlayerDock(html: string) {
	const dock = buildStandalonePlayerDock();
	if (/<\/body>/i.test(html)) {
		return html.replace(/<\/body>/i, `${dock}</body>`);
	}

	return `${html}${dock}`;
}

export function rewriteStandaloneAssetUrls(html: string, jobId: string, options?: StandaloneManagementOptions) {
	const rewritten = html
		.replaceAll('./player.css', buildAssetUrl(jobId, 'player.css'))
		.replaceAll('./audio.mp3', buildAssetUrl(jobId, 'audio.mp3'))
		.replaceAll('./player.js', buildAssetUrl(jobId, 'player.js'))
		.replaceAll(/\.\/illustrations\/([^"'?#>]+)/g, (_match, assetName: string) => {
			return buildAssetUrl(jobId, `illustrations/${assetName}`);
		});

	return injectManagementBar(injectStandalonePlayerDock(rewritten), jobId, options);
}