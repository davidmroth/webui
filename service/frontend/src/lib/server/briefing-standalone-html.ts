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

	.hero-audio.webui-docked-player .hero-audio-player {
		position: relative;
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
		gap: 0.65rem;
		align-items: center;
		margin-top: 0.6rem;
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
		gap: 0.4rem;
		justify-content: flex-end;
		align-items: center;
	}

	.hero-audio.webui-docked-player .webui-narration-actions button {
		appearance: none;
		border: 1px solid rgba(82, 62, 39, 0.14);
		border-radius: 999px;
		padding: 0.58rem 0.92rem;
		font: 600 0.92rem/1 var(--font-sans, system-ui, sans-serif);
		cursor: pointer;
		background: rgba(255, 255, 255, 0.92);
		color: var(--ink, #22190f);
	}

	.hero-audio.webui-docked-player .webui-narration-actions .webui-play-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}

	.hero-audio.webui-docked-player .webui-narration-actions .webui-play-toggle svg {
		width: 0.95rem;
		height: 0.95rem;
		fill: currentColor;
		flex: 0 0 auto;
	}

	.hero-audio.webui-docked-player .webui-narration-actions button:hover {
		border-color: rgba(138, 67, 21, 0.24);
		background: rgba(255, 255, 255, 1);
	}

	.hero-audio.webui-docked-player .webui-icon-toggle {
		appearance: none;
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		padding: 0.2rem;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: rgba(82, 62, 39, 0.74);
		cursor: pointer;
		line-height: 0;
	}

	.hero-audio.webui-docked-player .webui-icon-toggle:hover {
		color: rgba(82, 62, 39, 1);
	}

	.hero-audio.webui-docked-player .webui-icon-toggle svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: transform 160ms ease;
		transform: rotate(0deg);
	}

	.hero-audio.webui-docked-player .webui-icon-toggle[aria-expanded="true"] svg {
		transform: rotate(180deg);
	}

	[data-webui-active="true"] {
		scroll-margin-top: 8rem;
	}

	.hero-audio.webui-docked-player[data-webui-expanded="false"] audio {
		display: none;
	}

	.hero-audio.webui-docked-player[data-webui-expanded="false"] .hero-audio-label {
		display: none;
	}

	.hero-audio.webui-docked-player[data-webui-expanded="true"] audio {
		display: block;
		margin-top: 0.75rem;
	}

	.hero-audio.webui-docked-player[data-webui-sticky="true"][data-webui-inline="false"] .hero-audio-player {
		position: fixed;
		top: var(--webui-sticky-top, calc(var(--chat-viewport-offset-top, 0px) + 0.75rem));
		left: var(--webui-sticky-left, 0px);
		width: var(--webui-sticky-width, auto);
		z-index: 20;
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

		const stickySentinel = document.createElement('div');
		stickySentinel.setAttribute('aria-hidden', 'true');
		stickySentinel.style.height = '1px';
		stickySentinel.style.pointerEvents = 'none';
		if (parent) {
			parent.insertBefore(stickySentinel, stickyPlayer);
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
		playButton.className = 'webui-play-toggle';

		const expandButton = document.createElement('button');
		expandButton.type = 'button';
		expandButton.className = 'webui-icon-toggle';
		expandButton.setAttribute('aria-expanded', 'false');

		actions.append(playButton);
		toolbar.append(status, actions);

		const label = playerBox.querySelector('.hero-audio-label');
		if (label instanceof HTMLElement) {
			label.insertAdjacentElement('afterend', toolbar);
		} else {
			playerBox.insertBefore(toolbar, audio);
		}
		playerBox.appendChild(expandButton);

		let preferencePinned = false;
		let isExpanded = false;

		function applyStickyGeometry() {
			const stickyEnabled = stickyPlayer.dataset.webuiSticky === 'true' && stickyPlayer.dataset.webuiInline === 'false';

			if (!stickyEnabled) {
				stickyPlayer.style.removeProperty('--webui-sticky-top');
				stickyPlayer.style.removeProperty('--webui-sticky-left');
				stickyPlayer.style.removeProperty('--webui-sticky-width');
				stickyPlayer.style.removeProperty('min-height');
				return;
			}

			const rootStyles = getComputedStyle(document.documentElement);
			const viewportOffset = Number.parseFloat(rootStyles.getPropertyValue('--chat-viewport-offset-top'));
			const stickyOffset = Number.isFinite(viewportOffset) ? viewportOffset + 12 : 12;
			const playerRect = stickyPlayer.getBoundingClientRect();
			const maxStickyWidth = 800;
			const viewportGutter = 16;
			const viewportWidth = Number.isFinite(window.innerWidth) ? window.innerWidth : playerRect.width;
			const availableWidth = Math.max(280, viewportWidth - viewportGutter * 2);
			const stickyWidth = Math.min(playerRect.width, maxStickyWidth, availableWidth);
			const centeredLeft = playerRect.left + (playerRect.width - stickyWidth) / 2;
			const stickyLeft = Math.max(viewportGutter, Math.min(centeredLeft, viewportWidth - viewportGutter - stickyWidth));

			stickyPlayer.style.setProperty('--webui-sticky-top', stickyOffset + 'px');
			stickyPlayer.style.setProperty('--webui-sticky-left', stickyLeft + 'px');
			stickyPlayer.style.setProperty('--webui-sticky-width', stickyWidth + 'px');
			stickyPlayer.style.minHeight = playerBox.offsetHeight + 'px';
		}

		function syncExpandButtonUi() {
			expandButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 15l6-6 6 6"></path></svg>';
			expandButton.setAttribute('aria-label', isExpanded ? 'Collapse narration panel' : 'Expand narration panel');
		}

		function syncPlayButtonUi() {
			if (audio.paused) {
				playButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polygon points="7,5 7,19 19,12"></polygon></svg><span>Play</span>';
				playButton.setAttribute('aria-label', 'Play narration');
				return;
			}

			playButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg><span>Pause</span>';
			playButton.setAttribute('aria-label', 'Pause narration');
		}

		function setPlacement(nextPlacement) {
			stickyPlayer.dataset.webuiPlacement = nextPlacement;
			if (nextPlacement === 'hero') {
				if (anchor.parentNode) {
					anchor.parentNode.insertBefore(stickyPlayer, anchor.nextSibling);
				}
				requestAnimationFrame(applyStickyGeometry);
				return;
			}

			if (rail.firstChild) {
				rail.insertBefore(stickyPlayer, rail.firstChild);
			} else {
				rail.appendChild(stickyPlayer);
			}

			requestAnimationFrame(applyStickyGeometry);
		}

		function formatTime(seconds) {
			const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
			const minutes = Math.floor(safeSeconds / 60);
			const remainder = safeSeconds % 60;
			return minutes + ':' + String(remainder).padStart(2, '0');
		}

		const cueTargets = Array.from(document.querySelectorAll('[data-start][data-end]'));
		const navLinks = Array.from(document.querySelectorAll('.article-nav-item a[href^="#section-"]'));

		function syncActiveCueState() {
			const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
			let activeSectionId = null;

			cueTargets.forEach((target) => {
				if (!(target instanceof HTMLElement)) {
					return;
				}

				const cueStart = Number.parseFloat(target.dataset.start || 'NaN');
				const cueEnd = Number.parseFloat(target.dataset.end || 'NaN');
				const isActive = Number.isFinite(cueStart) && Number.isFinite(cueEnd) && currentTime >= cueStart && currentTime < cueEnd;
				target.dataset.webuiActive = isActive ? 'true' : 'false';

				if (isActive && target.classList.contains('section-card')) {
					activeSectionId = target.id || null;
				}
			});

			navLinks.forEach((link) => {
				if (!(link instanceof HTMLAnchorElement)) {
					return;
				}

				const targetSectionId = link.getAttribute('href')?.slice(1) || '';
				const isActive = Boolean(activeSectionId) && targetSectionId === activeSectionId;
				link.classList.toggle('active', isActive);
				link.dataset.webuiActive = isActive ? 'true' : 'false';
			});
		}

		function syncPlaybackState() {
			stateLabel.textContent = audio.paused ? 'Ready' : 'Playing';
			cueLabel.textContent = 'Current cue ' + formatTime(audio.currentTime || 0);
			syncPlayButtonUi();
			syncActiveCueState();
		}

		function seekAndPlay(cueStart) {
			const canSeekNow = () => {
				for (let i = 0; i < audio.seekable.length; i += 1) {
					if (cueStart >= audio.seekable.start(i) && cueStart <= audio.seekable.end(i)) {
						return true;
					}
				}
				return false;
			};

			const applySeek = () => {
				audio.currentTime = cueStart;
				syncPlaybackState();
			};

			applySeek();
			if (audio.paused) {
				void audio.play().catch(() => {});
				return;
			}

			if (canSeekNow()) {
				return;
			}

			const replaySeek = () => {
				applySeek();
			};

			audio.addEventListener('loadedmetadata', replaySeek, { once: true });
			audio.addEventListener('canplay', replaySeek, { once: true });

			void audio.play().catch(() => {});
		}

		function setExpanded(nextExpanded) {
			isExpanded = nextExpanded;
			stickyPlayer.dataset.webuiExpanded = nextExpanded ? 'true' : 'false';
			expandButton.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
			syncExpandButtonUi();
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

		function observeStickyActivation() {
			if (!(stickySentinel instanceof HTMLElement)) {
				stickyPlayer.dataset.webuiSticky = 'false';
				return;
			}

			const rootStyles = getComputedStyle(document.documentElement);
			const viewportOffset = Number.parseFloat(rootStyles.getPropertyValue('--chat-viewport-offset-top'));
			const stickyOffset = Number.isFinite(viewportOffset) ? viewportOffset + 12 : 12;

			const observer = new IntersectionObserver(
				([entry]) => {
					stickyPlayer.dataset.webuiSticky = entry && !entry.isIntersecting ? 'true' : 'false';
					requestAnimationFrame(applyStickyGeometry);
				},
				{
					threshold: 0,
					rootMargin: '-' + stickyOffset + 'px 0px 0px 0px'
				}
			);

			observer.observe(stickySentinel);
		}

		function resolveCueTarget(startNode) {
			const baseElement = startNode instanceof Element
				? startNode
				: startNode instanceof Node
					? startNode.parentElement
					: null;

			if (!(baseElement instanceof Element)) {
				return null;
			}

			const directTarget = baseElement.closest('[data-start][data-end]');
			if (directTarget instanceof HTMLElement) {
				return directTarget;
			}

			const sectionCard = baseElement.closest('.section-card');
			const isBodyTextClick = Boolean(baseElement.closest('.section-body'));

			if (isBodyTextClick && sectionCard instanceof HTMLElement) {
				return sectionCard;
			}

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
			seekAndPlay(cueStart);
		}

		function bindDirectCueSeek() {
			const textTargets = document.querySelectorAll('.section-sentence, .section-body p');

			const activateNodeSeek = (node, event) => {
				const directTarget = node.closest('[data-start][data-end]');
				const sectionCard = node.closest('.section-card');
				if (!(sectionCard instanceof HTMLElement)) {
					return;
				}

				const cueSource =
					directTarget instanceof HTMLElement && Number.isFinite(Number.parseFloat(directTarget.dataset.start || 'NaN'))
						? directTarget
						: sectionCard;

				const cueStart = Number.parseFloat(cueSource.dataset.start || 'NaN');
				if (!Number.isFinite(cueStart)) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();
				seekAndPlay(cueStart);
			};

			textTargets.forEach((node) => {
				if (!(node instanceof HTMLElement)) {
					return;
				}

				node.addEventListener('click', (event) => {
					activateNodeSeek(node, event);
				});

				if (node.classList.contains('section-sentence')) {
					node.addEventListener('keydown', (event) => {
						if (!(event instanceof KeyboardEvent)) {
							return;
						}
						if (event.key !== 'Enter' && event.key !== ' ') {
							return;
						}
						activateNodeSeek(node, event);
					});
				}
			});
		}

		function localizeGeneratedAt() {
			const generatedNodes = document.querySelectorAll('[data-generated-at]');

			generatedNodes.forEach((node) => {
				if (!(node instanceof HTMLElement)) {
					return;
				}

				const rawValue = node.dataset.generatedAt;
				if (!rawValue) {
					return;
				}

				const parsed = new Date(rawValue);
				if (Number.isNaN(parsed.getTime())) {
					return;
				}

				const formatter = new Intl.DateTimeFormat(undefined, {
					year: 'numeric',
					month: 'short',
					day: 'numeric',
					hour: 'numeric',
					minute: '2-digit',
					timeZoneName: 'short'
				});

				node.textContent = formatter.format(parsed);
				node.setAttribute('title', rawValue);
			});
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
		audio.addEventListener('play', syncPlaybackState);
		audio.addEventListener('pause', syncPlaybackState);
		audio.addEventListener('ended', syncPlaybackState);
		document.addEventListener('click', handleDelegatedCueSeek, true);
		bindDirectCueSeek();

		if (typeof breakpoint.addEventListener === 'function') {
			breakpoint.addEventListener('change', dockForViewport);
		} else if (typeof breakpoint.addListener === 'function') {
			breakpoint.addListener(dockForViewport);
		}

		window.addEventListener('resize', () => {
			requestAnimationFrame(applyStickyGeometry);
		});

		dockForViewport();
		observeStickyActivation();
		localizeGeneratedAt();
		syncPlaybackState();
		syncExpandButtonUi();
		requestAnimationFrame(applyStickyGeometry);
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

// ─── Page generation from manifest data ──────────────────────────────────────

interface BriefingPageMetricCard {
	id: string;
	label: string;
	value: string;
	trend: string | null;
	cue: { start: number; end: number } | null;
}

interface BriefingPageSentenceSpan {
	text: string;
	start: number;
	end: number;
	cue?: { start: number; end: number } | null;
}

interface BriefingPageSection {
	id: string;
	title: string;
	body: string[];
	narration?: string;
	sentences?: BriefingPageSentenceSpan[];
	metrics: BriefingPageMetricCard[];
	start: number;
	end: number;
	cue: { start: number; end: number } | null;
}

interface BriefingPageSource {
	id: string;
	title: string;
	publisher: string;
	url: string;
}

interface BriefingPageData {
	title: string;
	topic?: string;
	generatedAt?: string;
	locale: string;
	audioUrl: string;
	sections: BriefingPageSection[];
	sources: BriefingPageSource[];
}

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

const PAGE_BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:Georgia,'Times New Roman',serif;font-size:1rem;line-height:1.6;color:#1a1409;background:radial-gradient(140% 110% at 18% 6%, #f6efe1 0%, #efebe3 46%, #e8e4dd 100%)}
a{color:#b8860b;text-decoration:none}a:hover{color:#8a4315}
.page-shell{max-width:1400px;margin:0 auto;padding:2rem 1.25rem 2.5rem}
.hero{padding:2.3rem 2.2rem 2rem;border:1px solid rgba(82,62,39,.08);border-radius:.75rem;background:linear-gradient(112deg, rgba(255,252,247,.98) 0%, rgba(251,247,240,.96) 55%, rgba(245,239,230,.92) 100%);box-shadow:0 28px 62px rgba(63,45,24,.12)}
.hero-eyebrow{display:inline-flex;align-items:center;justify-content:center;padding:.36rem .9rem;border-radius:.75rem;background:#22190f;color:rgba(255,252,247,.92);font:700 .78rem/1.1 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.13em;text-transform:uppercase}
.hero-title{margin:.95rem 0 0;color:#1a1409;font-size:clamp(2.1rem,5.5vw,6rem);line-height:.95;letter-spacing:-.02em;text-wrap:balance}
.hero-subtitle{margin:1rem 0 0;color:rgba(63,45,24,.76);font-size:clamp(1.1rem,2.2vw,2.2rem);line-height:1.2}
.hero-audio{data-sticky-player:true}
.hero-audio-player{max-width:100%;margin:0;padding:1rem 1.2rem;border-radius:.75rem;background:rgba(245,244,242,.9)}
.hero-audio-label{font-size:.75rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(82,62,39,.6);margin:0 0 .5rem}
audio{width:100%;display:block;margin-top:.5rem}
.content-wrap{display:grid;grid-template-columns:260px minmax(0,1fr);gap:2rem;padding:1.4rem .6rem 0;align-items:start}
.article-rail{display:grid;gap:1rem;align-content:start;position:sticky;top:1.5rem;max-height:calc(100vh - 3rem);overflow-y:auto;padding-right:.2rem}
.article-nav{position:static;max-height:none;overflow:visible}
.article-nav-title{font-size:.85rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(82,62,39,.6);margin:0 0 1rem}
.article-nav-list{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}
.article-nav-item a{display:block;padding:.5rem .75rem;font-size:.9rem;color:#b8860b;border-radius:.75rem;transition:all .2s}
.article-nav-item a:hover{background:rgba(184,134,11,.1);color:#8a4315}
.article-nav-item a.active{background:rgba(184,134,11,.15);font-weight:600;color:#8a4315}
.article-body{min-width:0}
.briefing-metadata{background:rgba(82,62,39,.05);padding:1rem 1.5rem;border-radius:.75rem;margin:0 0 1.5rem;font-size:.9rem}
.metadata-item{display:grid;grid-template-columns:120px minmax(0,1fr);gap:1rem;margin:0 0 .5rem}
.metadata-label{font-weight:700;color:rgba(82,62,39,.7)}
.metadata-value{color:#1a1409}
.section-card{margin:0 0 2rem;padding:1.5rem;background:#fff;border-radius:.75rem;border:1px solid rgba(82,62,39,.08)}
.section-card[data-webui-active="true"]{border-color:rgba(184,134,11,.32);box-shadow:0 18px 36px rgba(184,134,11,.08)}
.section-header{display:grid;grid-template-columns:1fr auto;align-items:flex-start;gap:1rem;margin:0 0 1rem;padding-bottom:1rem;border-bottom:1px solid rgba(82,62,39,.1)}
.section-meta{font-size:.8rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:rgba(82,62,39,.6);margin:0}
.section-heading{font-size:1.35rem;font-weight:700;margin:0;color:#1a1409}
.section-timing{text-align:right;font-size:.8rem;color:rgba(82,62,39,.6)}
.section-body{display:grid;gap:1rem}
.section-body p{margin:0;font-size:1.05rem;line-height:1.7;color:#2d241a}
.section-body p:has(.section-sentence){display:block}
.section-sentence{display:inline;color:inherit;cursor:pointer;border-radius:.75rem;padding:0;margin:0;line-height:inherit}
.section-sentence:hover{text-decoration:underline;text-decoration-color:rgba(138,67,21,.35);text-decoration-thickness:.08em;text-underline-offset:.16em}
.section-sentence:focus-visible{outline:2px solid rgba(184,134,11,.45);outline-offset:2px;border-radius:.75rem}
.section-sentence[data-webui-active="true"]{background:linear-gradient(180deg, rgba(255,248,220,0) 0%, rgba(255,232,163,.72) 100%);border-radius:.75rem;box-shadow:0 0 0 .12rem rgba(255,232,163,.42)}
.source-cue{background:rgba(184,134,11,.08);padding:.75rem 1rem;border-left:3px solid #b8860b;margin:1rem 0;font-size:.9rem;border-radius:.75rem}
.source-cue-label{font-weight:700;color:#b8860b;display:block;margin-bottom:.25rem}
.source-cue-text{color:rgba(82,62,39,.7)}
.metrics-display{display:flex;flex-wrap:wrap;gap:1rem;margin:1rem 0}
.metric-badge{padding:.75rem 1.25rem;background:rgba(255,252,247,.8);border:1px solid rgba(82,62,39,.12);border-radius:.75rem;font-size:.95rem;display:grid;gap:.25rem}
.metric-badge[data-webui-active="true"]{border-color:rgba(184,134,11,.36);background:rgba(255,248,220,.92)}
.metric-label{font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(82,62,39,.6)}
.metric-value{font-size:1.25rem;font-weight:700;color:#1a1409}
.sources-list{list-style:none;margin:2rem 0 0;padding:0;border-top:1px solid rgba(82,62,39,.1);padding-top:1.5rem;display:grid;gap:.75rem}
.sources-heading{font-size:.9rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(82,62,39,.6);margin:0 0 1rem}
.source-link{display:block;padding:.75rem;border-radius:.75rem;transition:all .2s}
.source-link:hover{background:rgba(184,134,11,.1)}
.source-title{font-weight:700;color:#b8860b;display:block}
.source-publisher{font-size:.85rem;color:rgba(82,62,39,.6);display:block;margin-top:.25rem}
.on-this-page{font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(82,62,39,.6);margin:2rem 0 .75rem}
@media(max-width:960px){.page-shell{padding:1rem .85rem 2rem}.hero{padding:1.2rem 1rem 1rem;border-radius:.75rem}.hero-audio-player{margin-top:1rem;padding:.8rem .85rem}.content-wrap{grid-template-columns:1fr;padding:1.1rem 0 0}.article-rail{position:static;top:auto;max-height:none;overflow:visible;padding-right:0}.article-nav{position:static;max-height:none;margin-bottom:1.5rem;padding-bottom:1.5rem;border-bottom:1px solid rgba(82,62,39,.1)}}
`.trim();

function formatSeconds(sec: number): string {
	const total = Math.floor(sec);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function renderMetricCards(metrics: BriefingPageMetricCard[]): string {
	if (!metrics.length) return '';
	const cards = metrics.map((m) => {
		const cueAttrs = m.cue ? ` data-start="${m.cue.start}" data-end="${m.cue.end}"` : '';
		const trend = m.trend ? `<div style="margin-top:.15rem">${escapeHtml(m.trend)}</div>` : '';
		return `<div class="metric-badge" id="${escapeAttribute(m.id)}"${cueAttrs}><div class="metric-label">${escapeHtml(m.label)}</div><div class="metric-value">${escapeHtml(m.value)}</div>${trend}</div>`;
	});
	return `<div class="metrics-display">${cards.join('')}</div>`;
}

function splitNarrationIntoParagraphs(narration: string): string[] {
	return narration
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);
}

function resolveSectionParagraphs(section: BriefingPageSection): string[] {
	if (section.body.length > 0) {
		return section.body;
	}

	const narration = typeof section.narration === 'string' ? section.narration.trim() : '';
	if (narration) {
		return splitNarrationIntoParagraphs(narration);
	}

	if (Array.isArray(section.sentences) && section.sentences.length > 0) {
		const sentenceCopy = section.sentences
			.map((sentence) => sentence.text.trim())
			.filter(Boolean)
			.join(' ')
			.trim();
		return sentenceCopy ? [sentenceCopy] : [];
	}

	return [];
}

function renderSentenceCopy(section: BriefingPageSection): string {
	if (!Array.isArray(section.sentences) || section.sentences.length === 0) {
		return '';
	}

	const sentenceHtml = section.sentences
		.map((sentence) => {
			const cueStart = sentence.cue?.start ?? sentence.start;
			const cueEnd = sentence.cue?.end ?? sentence.end;
			return `<span class="section-sentence" data-start="${cueStart}" data-end="${cueEnd}" tabindex="0" role="button">${escapeHtml(sentence.text)}</span>`;
		})
		.join(' ');

	return `<div class="section-body"><p>${sentenceHtml}</p>${renderMetricCards(section.metrics)}</div>`;
}

function renderPageSection(idx: number, section: BriefingPageSection): string {
	const sectionNum = String(idx + 1).padStart(2, '0');
	const cueAttrs = section.cue
		? ` data-start="${section.cue.start}" data-end="${section.cue.end}"`
		: section.start != null
			? ` data-start="${section.start}" data-end="${section.end}"`
			: '';
	const timing = section.start != null ? `Narration cue ${formatSeconds(section.start)} to ${formatSeconds(section.end)}` : '';
	const headerHtml = `<div class="section-header">
		<div>
			<h2 class="section-meta">SECTION ${sectionNum}</h2>
			<h3 class="section-heading" style="margin-top:.5rem">${escapeHtml(section.title)}</h3>
		</div>
		${timing ? `<div class="section-timing">${escapeHtml(timing)}</div>` : ''}
	</div>`;

	const sentenceBodyHtml = renderSentenceCopy(section);
	const paragraphs = sentenceBodyHtml ? [] : resolveSectionParagraphs(section);
	const paragraphBodyHtml = paragraphs.length
		? `<div class="section-body">${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n')}${renderMetricCards(section.metrics)}</div>`
		: '';
	const bodyHtml = sentenceBodyHtml || paragraphBodyHtml;

	return `<section class="section-card" id="section-${idx}"${cueAttrs}>${headerHtml}${bodyHtml}</section>`;
}

function renderSectionNavigation(sections: BriefingPageSection[]): string {
	const items = sections
		.map((s, i) => {
			const sectionNum = String(i + 1).padStart(2, '0');
			const timing = s.start != null ? ` ${formatSeconds(s.start)} section window` : '';
			return `<li class="article-nav-item"><a href="#section-${i}">${sectionNum} ${escapeHtml(s.title)}${timing}</a></li>`;
		})
		.join('');
	return `<aside class="article-rail"><nav class="article-nav">
		<h2 class="article-nav-title">Article navigation</h2>
		<ul class="article-nav-list">${items}</ul>
		<div class="on-this-page">On this page</div>
	</nav></aside>`;
}

function renderPageSources(sources: BriefingPageSource[]): string {
	if (!sources.length) return '';
	const items = sources
		.map((s) => `<a href="${escapeAttribute(s.url)}" class="source-link" target="_blank" rel="noopener noreferrer">
			<span class="source-title">${escapeHtml(s.title)}</span>
			<span class="source-publisher">${escapeHtml(s.publisher)}</span>
		</a>`)
		.join('');
	return `<section><h2 class="sources-heading">Sources</h2><div class="sources-list">${items}</div></section>`;
}

export function buildBriefingPageHtml(data: BriefingPageData, jobId: string, options?: StandaloneManagementOptions): string {
	const navHtml = renderSectionNavigation(data.sections);
	const sectionsHtml = data.sections.map((s, i) => renderPageSection(i, s)).join('\n');
	const sourcesHtml = renderPageSources(data.sources);

	const html = `<!DOCTYPE html>
<html lang="${escapeAttribute(data.locale ?? 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.title)}</title>
<style>${PAGE_BASE_CSS}</style>
</head>
<body>
<main class="page-shell">
<section class="hero">
<div class="hero-eyebrow">Briefing</div>
<h1 class="hero-title">${escapeHtml(data.title)}</h1>
<p class="hero-subtitle">${escapeHtml(data.topic || data.title)}</p>
<div class="hero-audio" data-sticky-player>
<div class="hero-audio-player">
<div class="hero-audio-label">Narration</div>
<audio controls preload="none" data-briefing-audio>
<source src="${escapeAttribute(data.audioUrl)}" type="audio/mpeg" />
</audio>
</div>
</div>
</section>
<div class="content-wrap">
${navHtml}
<article class="article-body">
<div class="briefing-metadata">
<div class="metadata-item">
<div class="metadata-label">Generated:</div>
<div class="metadata-value"><time data-generated-at="${escapeAttribute(data.generatedAt || '')}">${escapeHtml(data.generatedAt || 'Recently')}</time></div>
</div>
<div class="metadata-item">
<div class="metadata-label">Sources:</div>
<div class="metadata-value">${data.sources.length}</div>
</div>
</div>
${sectionsHtml}
${sourcesHtml}
</article>
</div>
</main>
${buildStandalonePlayerDock()}
</body>
</html>`;

	return injectManagementBar(html, jobId, options);
}

// ─── Legacy: rewrite asset URLs in renderer-generated standalone.html ─────────

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