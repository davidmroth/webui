import { json } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import { getHermesSlashCommands } from '$server/slash-commands';

export async function GET(event) {
  await requireSession(event);
  return json(getHermesSlashCommands());
}
