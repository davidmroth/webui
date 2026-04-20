import { redirect } from '@sveltejs/kit';
import { destroyUserSession } from '$server/auth';

export async function POST(event) {
  await destroyUserSession(event);
  throw redirect(303, '/login');
}
