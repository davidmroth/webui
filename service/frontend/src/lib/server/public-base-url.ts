function firstHeaderValue(value: string | null): string {
	return value?.split(',')[0]?.trim() ?? '';
}

export function derivePublicBaseUrl(request: Request, fallbackOrigin: string): string {
	const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
	const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));

	if (forwardedProto && forwardedHost) {
		return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, '');
	}

	return fallbackOrigin.replace(/\/$/, '');
}