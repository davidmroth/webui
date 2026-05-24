import { createHash } from 'node:crypto';

export function buildEtag(value: unknown): string {
	const digest = createHash('sha1').update(JSON.stringify(value)).digest('hex');
	return `"${digest}"`;
}

export function requestHasMatchingEtag(request: Request, etag: string): boolean {
	const header = request.headers.get('if-none-match');
	if (!header) {
		return false;
	}

	if (header.trim() === '*') {
		return true;
	}

	return header
		.split(',')
		.map((candidate) => candidate.trim())
		.includes(etag);
}