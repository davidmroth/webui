import { json } from '@sveltejs/kit';
import { getConfig } from './env';

export function isAuthorizedInternalService(request: Request) {
	const expected = getConfig().hermesServiceToken;
	const authHeader = request.headers.get('authorization') || '';
	return authHeader === `Bearer ${expected}`;
}

export function unauthorizedInternalServiceResponse() {
	return json({ error: 'Unauthorized' }, { status: 401 });
}