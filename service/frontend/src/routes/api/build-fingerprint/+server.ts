import { json } from '@sveltejs/kit';
import { getBuildInfo } from '$server/maintenance';

export async function GET() {
  const build = await getBuildInfo();
  const version = String(build.frontend ?? '0.0.0');

  return json(
    {
      version,
      fingerprint: version,
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
