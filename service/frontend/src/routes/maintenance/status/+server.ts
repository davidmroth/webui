import { json } from '@sveltejs/kit';
import {
  collectMaintenanceHermesConnectionStatus,
  hasMaintenanceAccess,
  isMaintenanceEnabled
} from '$server/maintenance';

const NO_STORE_HEADERS = {
  'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  pragma: 'no-cache',
  expires: '0'
};

export async function GET(event) {
  if (!isMaintenanceEnabled() || !hasMaintenanceAccess(event)) {
    return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  return json(await collectMaintenanceHermesConnectionStatus(), {
    headers: NO_STORE_HEADERS
  });
}