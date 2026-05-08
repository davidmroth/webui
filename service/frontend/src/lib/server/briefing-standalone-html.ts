function encodeAssetPath(assetPath: string) {
	return assetPath
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');
}

function buildAssetUrl(jobId: string, assetPath: string) {
	return `/api/briefings/${encodeURIComponent(jobId)}/assets/${encodeAssetPath(assetPath)}`;
}

export function rewriteStandaloneAssetUrls(html: string, jobId: string) {
	return html
		.replaceAll('./player.css', buildAssetUrl(jobId, 'player.css'))
		.replaceAll('./audio.mp3', buildAssetUrl(jobId, 'audio.mp3'))
		.replaceAll('./player.js', buildAssetUrl(jobId, 'player.js'))
		.replaceAll(/\.\/illustrations\/([^"'?#>]+)/g, (_match, assetName: string) => {
			return buildAssetUrl(jobId, `illustrations/${assetName}`);
		});
}