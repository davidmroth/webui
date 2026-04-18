import { fail, redirect } from '@sveltejs/kit';
import {
  authorizeMaintenance,
  clearMaintenanceCookie,
  collectMaintenanceSnapshot,
  hasMaintenanceAccess,
  isMaintenanceEnabled
} from '$server/maintenance';

export async function load(event) {
  const queryToken = event.url.searchParams.get('token')?.trim() ?? '';
  if (queryToken) {
    if (!authorizeMaintenance(event, queryToken)) {
      return {
        enabled: isMaintenanceEnabled(),
        authorized: false,
        tokenError: 'That maintenance token was not recognized.'
      };
    }
    throw redirect(303, '/maintenance');
  }

  const enabled = isMaintenanceEnabled();
  if (!enabled) {
    return {
      enabled,
      authorized: false,
      tokenError: null
    };
  }

  if (!hasMaintenanceAccess(event)) {
    return {
      enabled,
      authorized: false,
      tokenError: null
    };
  }

  return {
    enabled,
    authorized: true,
    tokenError: null,
    snapshot: await collectMaintenanceSnapshot(event)
  };
}

export const actions = {
  login: async (event) => {
    const formData = await event.request.formData();
    const token = String(formData.get('token') || '').trim();
    if (!token) {
      return fail(400, { error: 'A maintenance token is required.' });
    }

    if (!authorizeMaintenance(event, token)) {
      return fail(401, { error: 'That maintenance token was not recognized.' });
    }

    throw redirect(303, '/maintenance');
  },
  logout: async (event) => {
    clearMaintenanceCookie(event);
    throw redirect(303, '/maintenance');
  }
};