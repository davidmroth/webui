import { fail, redirect } from '@sveltejs/kit';
import { authenticateApiKey, createUserSession } from '$server/auth';

function safeReturnTo(raw: string | null): string {
  if (!raw) return '/chat';
  try {
    const decoded = decodeURIComponent(raw);
    // Only allow relative paths starting with / to prevent open-redirect.
    if (decoded.startsWith('/') && !decoded.startsWith('//')) {
      return decoded;
    }
  } catch {
    // Ignore malformed values.
  }
  return '/chat';
}

export async function load({ locals, url }) {
  if (locals.session) {
    throw redirect(303, safeReturnTo(url.searchParams.get('return_to')));
  }
  return { returnTo: url.searchParams.get('return_to') ?? '' };
}

export const actions = {
  default: async (event) => {
    const formData = await event.request.formData();
    const apiKey = String(formData.get('apiKey') || '').trim();
    if (!apiKey) {
      return fail(400, { error: 'A valid access key is required.' });
    }

    const user = await authenticateApiKey(apiKey);
    if (!user) {
      return fail(401, { error: 'That access key was not recognized.' });
    }

    await createUserSession(event, user);
    const returnTo = safeReturnTo(String(formData.get('return_to') || ''));
    throw redirect(303, returnTo);
  }
};
