import { getConfig } from '$server/env';

export async function load({ locals }) {
  const config = getConfig();

  return {
    session: locals.session,
    appName: config.publicAppName
  };
}
