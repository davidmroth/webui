(() => {
	const root = document.getElementById('preview-share-manager');
	if (!root) return;
	const launcher = document.getElementById('preview-share-launcher');
	const dialog = document.getElementById('preview-share-dialog');
	const panel = document.getElementById('preview-share-panel');
	const closeButton = document.getElementById('preview-share-close');
	const toggleButton = document.getElementById('share-toggle-button');
	const copyButton = document.getElementById('share-copy-button');
	const message = document.getElementById('share-manager-message');
	const standalonePath = root.dataset.standalonePath || window.location.pathname;
	const shareId = root.dataset.shareId || '';
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
			const response = await fetch('/api/previews/' + encodeURIComponent(shareId) + '/sharing', {
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
