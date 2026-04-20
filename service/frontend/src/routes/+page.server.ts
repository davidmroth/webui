import { redirect } from '@sveltejs/kit';

export async function load({ locals }) {
  if (locals.session) {
    throw redirect(303, '/chat');
  }
  throw redirect(303, '/login');
}
