export const standalonePlayerDockCss = `
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
	border-radius: 0.75rem;
	border: 1px solid rgba(82, 62, 39, 0.12);
	background: linear-gradient(140deg, rgba(255, 253, 248, 0.96) 0%, rgba(248, 243, 234, 0.94) 100%);
	box-shadow: 0 12px 26px rgba(82, 62, 39, 0.08);
	backdrop-filter: blur(14px);
	-webkit-backdrop-filter: blur(14px);
	height: 100px;
}

.hero-audio.webui-docked-player[data-webui-placement="rail"][data-webui-expanded="false"] .hero-audio-player {
	height: 100px;
	padding: 0.66rem 0.9rem;
	overflow: hidden;
}

.hero-audio.webui-docked-player[data-webui-placement="hero"] .hero-audio-player {
	padding: 1.1rem 1.2rem;
	border-radius: 0.75rem;
	border: 1px solid rgba(82, 62, 39, 0.1);
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
	display: grid;
	gap: 0.25rem;
	transform: translateY(15px);
}

.hero-audio.webui-docked-player .webui-narration-status-primary {
	display: flex;
	flex-wrap: wrap;
	gap: 0.35rem;
	font: 500 0.92rem/1.4 var(--font-sans, system-ui, sans-serif);
	color: var(--muted, rgba(82, 62, 39, 0.7));
}

.hero-audio.webui-docked-player .webui-narration-status-secondary {
	font: 500 0.78rem/1.3 var(--font-sans, system-ui, sans-serif);
	color: rgba(82, 62, 39, 0.54);
}

.hero-audio.webui-docked-player .webui-narration-status-secondary svg {
	width: 0.8rem;
	height: 0.8rem;
	stroke: currentColor;
	fill: none;
	stroke-width: 1.9;
	stroke-linecap: round;
	stroke-linejoin: round;
	vertical-align: -0.1rem;
	margin-right: 0.26rem;
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
	padding: 0.4rem 0.8rem;
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

.hero-audio.webui-docked-player .webui-play-toggle.webui-play-toggle--icon {
	transform: translateX(-30px) translateY(15px);
	width: 2.7rem;
	height: 2.7rem;
	padding: 0;
	justify-content: center;
	border-color: rgba(82, 62, 39, 0.16);
	background: rgba(255, 255, 255, 0.9);
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.hero-audio.webui-docked-player .webui-play-toggle.webui-play-toggle--icon svg {
	width: 1rem;
	height: 1rem;
	margin-left: 0.05rem;
}

.hero-audio.webui-docked-player .webui-play-toggle.webui-play-toggle--icon span {
	display: none;
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

.hero-audio.webui-docked-player[data-webui-placement="rail"][data-webui-expanded="false"] .webui-narration-toolbar {
	margin-top: 0;
	gap: 0.56rem;
	align-items: center;
}

.hero-audio.webui-docked-player[data-webui-placement="rail"][data-webui-expanded="false"] .webui-narration-status {
	gap: 0.14rem;
	min-width: 0;
}

.hero-audio.webui-docked-player[data-webui-placement="rail"][data-webui-expanded="false"] .webui-narration-status-primary {
	font-size: 0.8rem;
	line-height: 1.18;
	gap: 0.28rem;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.hero-audio.webui-docked-player[data-webui-placement="rail"][data-webui-expanded="false"] .webui-narration-status-secondary {
	font-size: 0.75rem;
	line-height: 1.1;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.hero-audio.webui-docked-player[data-webui-placement="rail"][data-webui-expanded="false"] .webui-narration-actions {
	gap: 0.32rem;
	align-self: end;
}

.hero-audio.webui-docked-player[data-webui-placement="rail"][data-webui-expanded="true"] .webui-play-toggle {
	transform: translateX(-35px) translateY(15px);
}

.hero-audio.webui-docked-player[data-webui-expanded="true"] .webui-play-toggle {
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
`.trim();

export const standalonePlayerDockScript = `
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

	const primaryStatus = document.createElement('div');
	primaryStatus.className = 'webui-narration-status-primary';

	const stateLabel = document.createElement('span');
	const separator = document.createElement('span');
	separator.setAttribute('aria-hidden', 'true');
	separator.textContent = '·';
	const cueLabel = document.createElement('span');

	primaryStatus.append(stateLabel, separator, cueLabel);

	const secondaryStatus = document.createElement('div');
	secondaryStatus.className = 'webui-narration-status-secondary';

	status.append(primaryStatus, secondaryStatus);

	const actions = document.createElement('div');
	actions.className = 'webui-narration-actions';

	const playButton = document.createElement('button');
	playButton.type = 'button';
	playButton.className = 'webui-play-toggle webui-play-toggle--icon';

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
		const placement = stickyPlayer.dataset.webuiPlacement || 'hero';
		const playerRect = stickyPlayer.getBoundingClientRect();
		const sectionCard = document.querySelector('.section-card');
		const articleBody = document.querySelector('.article-body');
		const alignmentRect =
			placement === 'hero'
				? sectionCard instanceof HTMLElement
					? sectionCard.getBoundingClientRect()
					: articleBody instanceof HTMLElement
						? articleBody.getBoundingClientRect()
						: playerRect
				: playerRect;
		const maxStickyWidth = 800;
		const viewportGutter = 16;
		const viewportWidth = Number.isFinite(window.innerWidth) ? window.innerWidth : alignmentRect.width;
		const availableWidth = Math.max(280, viewportWidth - viewportGutter * 2);
		const stickyWidth = Math.min(alignmentRect.width, maxStickyWidth, availableWidth);
		const centeredLeft = alignmentRect.left + (alignmentRect.width - stickyWidth) / 2;
		const stickyLeft = Math.max(viewportGutter, Math.min(centeredLeft, viewportWidth - viewportGutter - stickyWidth));

		stickyPlayer.style.setProperty('--webui-sticky-top', stickyOffset + 'px');
		stickyPlayer.style.setProperty('--webui-sticky-left', stickyLeft + 'px');
		stickyPlayer.style.setProperty('--webui-sticky-width', stickyWidth + 'px');
		stickyPlayer.style.minHeight = playerBox.offsetHeight + 'px';
	}

	function syncExpandButtonUi() {
		expandButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 15l6-6 6 6"></path></svg>';
		expandButton.setAttribute('aria-label', isExpanded ? 'Collapse narration panel' : 'Expand narration panel');
		playButton.classList.add('webui-play-toggle--icon');
		const currentTime = audio.currentTime || 0;
		cueLabel.textContent = !isExpanded ? formatTime(currentTime) : 'Current cue ' + formatTime(currentTime);
	}

	function syncPlayButtonUi() {
		const isCompact = stickyPlayer.dataset.webuiPlacement === 'rail' && stickyPlayer.dataset.webuiExpanded === 'false';
		if (audio.paused) {
			playButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polygon points="7,5 7,19 19,12"></polygon></svg><span>Play</span>';
			playButton.setAttribute('aria-label', 'Play narration');
			playButton.classList.toggle('webui-play-toggle--icon', isCompact);
			return;
		}

		playButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg><span>Pause</span>';
		playButton.setAttribute('aria-label', 'Pause narration');
		playButton.classList.toggle('webui-play-toggle--icon', isCompact);
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

	navLinks.forEach((link) => {
		link.addEventListener('click', () => {
			navLinks.forEach((l) => l.classList.remove('active'));
			link.classList.add('active');
		});
	});

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
		const currentTime = audio.currentTime || 0;
		const duration = audio.duration || 0;
		const isFinite = Number.isFinite(duration);
		const isCompact = stickyPlayer.dataset.webuiPlacement === 'rail' && stickyPlayer.dataset.webuiExpanded === 'false';
		stateLabel.textContent = audio.paused ? 'Ready' : 'Playing';
		cueLabel.textContent = isCompact ? formatTime(currentTime) : 'Current cue ' + formatTime(currentTime);
		secondaryStatus.innerHTML = isFinite
			? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2"></path></svg><span>' + (isCompact ? formatTime(duration) : 'Duration ' + formatTime(duration)) + '</span>'
			: '';
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
	syncActiveCueState();
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
`.trim();