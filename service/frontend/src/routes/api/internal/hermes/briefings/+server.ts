import { json } from '@sveltejs/kit';
import {
  HermesBriefingRegistrationError,
  registerBriefingFromHermes
} from '$server/briefing-hermes';
import { getConfig } from '$server/env';
import {
  noteHermesWorkerAuthFailure,
  noteHermesWorkerHeartbeat
} from '$server/hermes-heartbeat';

function isAuthorized(request: Request) {
  const expected = getConfig().hermesServiceToken;
  return request.headers.get('authorization') === `Bearer ${expected}`;
}

export async function POST({ request }: { request: Request }) {
  if (!isAuthorized(request)) {
    noteHermesWorkerAuthFailure('briefings');
    return json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  noteHermesWorkerHeartbeat('briefings');
  const body = await request.json().catch(() => ({}));

  try {
    const record = await registerBriefingFromHermes(body);
    return json(
      {
        ok: true,
        jobId: record.jobId,
        state: record.state
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof HermesBriefingRegistrationError) {
      return json({ error: error.message, code: error.code }, { status: error.status });
    }

    return json(
      {
        error: 'Unable to register the briefing.',
        code: 'BRIEFING_REGISTRATION_FAILED'
      },
      { status: 500 }
    );
  }
}
