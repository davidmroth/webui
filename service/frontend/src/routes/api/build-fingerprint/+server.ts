import { json } from '@sveltejs/kit';
import { getBuildInfo } from '$server/maintenance';

export async function GET() {
  const build = await getBuildInfo();
  const fingerprint = [
    build.frontend,
    build.gitCommitShort ?? build.gitCommit ?? 'unknown',
    build.buildTime ?? 'unknown'
  ].join(':');

  return json(
    {
      fingerprint,
      build
    },
    {
      headers: {
        'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        pragma: 'no-cache',
        expires: '0'
      }
    }
  );
}
