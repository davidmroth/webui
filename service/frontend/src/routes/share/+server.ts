import { redirect } from '@sveltejs/kit';
import type { ServerGet } from './$types';

export const GET: ServerGet = async (event) => {
  const title = event.url.searchParams.get('title') ?? '';
  const text = event.url.searchParams.get('text') ?? '';
  const url = event.url.searchParams.get('url') ?? '';

  // Build the pre-filled message from shared data.
  // Priority: text > title, append url if present.
  let message = text || title;
  if (url && !message.includes(url)) {
    message = message ? `${message}\n${url}` : url;
  }

  // Encode the message as a query parameter so it survives the redirect.
  const encoded = encodeURIComponent(message);

  // Redirect to the chat page with the shared content pre-loaded.
  throw redirect(303, `/chat?share=${encoded}`);
};
