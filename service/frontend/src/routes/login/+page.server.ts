import { fail, redirect } from '@sveltejs/kit';
import { authenticateApiKey, createUserSession } from '$server/auth';

export async function load({ locals }) {
  if (locals.session) {
    throw redirect(303, '/chat');
  }
  return {};
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
    throw redirect(303, '/chat');
  }
};
