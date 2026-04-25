import { json } from '@sveltejs/kit';
import { getBuildInfo, resolveBuildFingerprint } from '$server/maintenance';

export async function GET() {
  const build = await getBuildInfo();
  const fingerprint = resolveBuildFingerprint(build);

  return json(
    {
      version: fingerprint,
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
