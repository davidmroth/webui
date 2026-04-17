import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { redirect, type RequestEvent } from '@sveltejs/kit';
import { execute, query } from './db';
import { getConfig } from './env';

interface UserRow {
  user_id: string;
  display_name: string;
}

interface SessionRow {
  session_id: string;
  user_id: string;
  display_name: string;
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function ensureBootstrapUser() {
  const config = getConfig();
  const users = await query<{ count: number }>('SELECT COUNT(*) AS count FROM users');
  if ((users[0]?.count ?? 0) > 0) {
    return;
  }

  const userId = randomUUID();
  const apiKeyId = randomUUID();
  await execute(
    'INSERT INTO users (id, user_id, display_name) VALUES (:id, :user_id, :display_name)',
    { id: userId, user_id: 'owner', display_name: config.bootstrapUserName }
  );
  await execute(
    'INSERT INTO api_keys (id, user_id, label, key_hash) VALUES (:id, :user_id, :label, :key_hash)',
    {
      id: apiKeyId,
      user_id: userId,
      label: 'Bootstrap key',
      key_hash: hashValue(config.bootstrapUserKey)
    }
  );
}

export async function authenticateApiKey(apiKey: string) {
  await ensureBootstrapUser();
  const rows = await query<UserRow>(
    `SELECT users.id AS user_id, users.display_name
     FROM api_keys
     INNER JOIN users ON users.id = api_keys.user_id
     WHERE api_keys.key_hash = :key_hash AND api_keys.revoked_at IS NULL
     LIMIT 1`,
    { key_hash: hashValue(apiKey) }
  );
  return rows[0] ?? null;
}

export async function createUserSession(event: RequestEvent, user: UserRow) {
  const config = getConfig();
  const token = randomBytes(24).toString('hex');
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  await execute(
    'INSERT INTO web_sessions (id, user_id, session_token_hash, expires_at) VALUES (:id, :user_id, :session_token_hash, :expires_at)',
    {
      id: sessionId,
      user_id: user.user_id,
      session_token_hash: hashValue(token),
      expires_at: expiresAt.toISOString().slice(0, 19).replace('T', ' ')
    }
  );

  event.cookies.set(config.sessionCookieName, token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: false,
    expires: expiresAt
  });
}

export async function destroyUserSession(event: RequestEvent) {
  const config = getConfig();
  const token = event.cookies.get(config.sessionCookieName);
  if (token) {
    await execute('DELETE FROM web_sessions WHERE session_token_hash = :session_token_hash', {
      session_token_hash: hashValue(token)
    });
  }
  event.cookies.delete(config.sessionCookieName, { path: '/' });
}

export async function resolveSession(event: RequestEvent) {
  const config = getConfig();
  const token = event.cookies.get(config.sessionCookieName);
  if (!token) {
    event.locals.session = null;
    return null;
  }

  const rows = await query<SessionRow>(
    `SELECT web_sessions.id AS session_id, users.id AS user_id, users.display_name
     FROM web_sessions
     INNER JOIN users ON users.id = web_sessions.user_id
     WHERE web_sessions.session_token_hash = :session_token_hash
       AND web_sessions.expires_at > UTC_TIMESTAMP()
     LIMIT 1`,
    { session_token_hash: hashValue(token) }
  );

  const session = rows[0]
    ? {
        id: rows[0].session_id,
        userId: rows[0].user_id,
        displayName: rows[0].display_name
      }
    : null;
  event.locals.session = session;
  return session;
}

export async function requireSession(event: RequestEvent) {
  const session = event.locals.session ?? (await resolveSession(event));
  if (!session) {
    throw redirect(303, '/login');
  }
  return session;
}
