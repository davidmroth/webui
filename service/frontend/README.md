# Hermes WebUI

Initial implementation of a browser-first Hermes channel using SvelteKit, MySQL, and S3-compatible object storage.

## What is implemented

- Server-rendered SvelteKit app with a Telegram-like two-pane chat layout.
- Per-user key login backed by MySQL.
- Session cookie auth for browser users.
- MySQL-backed conversations, messages, and Hermes inbox queue.
- Internal Hermes endpoints for health, inbox dequeue, event ack, and assistant message delivery.
- Docker Compose development stack that starts `webui`, `hermes`, `mysql`, and `minio`.

## What is not implemented yet

- Streaming assistant chunks in the browser.
- Rich message actions and llama.cpp UI feature parity.
- Durable retry leasing for Hermes events beyond the initial queue/ack path.

## Local development

1. Copy `.env.example` to `.env` and change at minimum `HERMES_WEBCHAT_SERVICE_TOKEN` and `BOOTSTRAP_USER_KEY`.
2. `BOOTSTRAP_USER_KEY` is the browser login key for the bootstrap owner account. `HERMES_WEBCHAT_SERVICE_TOKEN` is only for internal service-to-service authentication.
3. `HERMES_EVENT_LEASE_SECONDS` controls how long an in-flight Hermes event can stay in `processing` before the web UI makes it eligible for retry. This prevents transient Hermes failures from blackholing messages indefinitely.
4. `HERMES_WORKER_HEARTBEAT_STALE_SECONDS` controls when webui considers the Hermes webchat worker offline. When queued work exists past this heartbeat threshold, conversations are marked as stalled instead of indefinitely showing working.
5. The bootstrap owner record is kept in sync with `BOOTSTRAP_USER_NAME` and `BOOTSTRAP_USER_KEY`, so changing those values updates the bootstrap login instead of only applying on first database initialization.
6. `BODY_SIZE_LIMIT` controls the max HTTP request payload accepted by the SvelteKit Node server (defaults to `10M` in this repo). Increase it if users upload larger files.
7. Run `docker compose up --build` from this directory.
8. Open `http://localhost:3000` by default, or use whatever value you set for `WEBUI_PORT` in `.env`. If you access the dev server through a custom hostname such as `ai.local`, add it to `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` in `.env`. The exposed MySQL and MinIO ports are also configurable there. `MYSQL_HOST_PORT` only changes the port published to your host machine; the `webui` container still connects to the `mysql` service on internal port `3306` so host-port changes do not break container-to-container traffic. Similarly, `MINIO_API_PORT` is host-facing only; `webui` should connect to MinIO on internal port `9000`.
9. Sign in with the bootstrap key from `.env`.

For S3 or other managed object-storage providers, set `OBJECT_STORAGE_REGION` to the bucket region (for example `us-east-2`).
If your bucket is shared across services, set `OBJECT_STORAGE_PREFIX` (for example `hermes-webui/prod`) so all webui uploads stay in a dedicated namespace folder.

### Maintenance page

Set `MAINTENANCE_TOKEN` in `.env` to enable the token-gated maintenance page at `/maintenance`.

- You can unlock it with the form on the page or by opening `/maintenance?token=YOUR_TOKEN` once; that sets an HttpOnly cookie and redirects to a clean URL.
- The page exposes build metadata, runtime details, Hermes queue stats, database counts, object-storage status, and a raw JSON snapshot for debugging deployment mismatches.
- `MAINTENANCE_COOKIE_NAME` lets you override the cookie name if you need to run multiple instances side by side.

Optional llama-style display badges can be configured with `PUBLIC_MODEL_DISPLAY_NAME`, `PUBLIC_MODEL_SIZE_LABEL`, `PUBLIC_MODEL_CAPABILITY_LABEL`, and `PUBLIC_MODEL_FILE_LABEL`. These only affect the frontend metadata row shown under assistant messages.

The app runs versioned database migrations and records them in `schema_migrations`. Existing MySQL volumes are upgraded automatically on startup, and you can also run them explicitly during deploys with `docker compose exec webui yarn migrate`. If you run the CLI from the host shell instead, override `DATABASE_HOST` and `DATABASE_PORT` to point at the host-exposed MySQL port, which defaults to `MYSQL_HOST_PORT`.

The authenticated Hermes health endpoint reports queue counts and the latest worker heartbeat so you can quickly see whether events are queued while the Hermes poller is offline.

## Service contract

Hermes uses the `webchat` adapter to poll:

- `GET /api/internal/hermes/health`
- `GET /api/internal/hermes/inbox/next`
- `POST /api/internal/hermes/events/:id/ack`
- `POST /api/internal/hermes/conversations/:id/assistant`

The browser never sees the Hermes service token.

The maintenance page is separate from the browser login flow and uses `MAINTENANCE_TOKEN`, not `BOOTSTRAP_USER_KEY` or `HERMES_WEBCHAT_SERVICE_TOKEN`.

Assistant replies can include files in either of these forms:

1. `multipart/form-data` with one or more `attachments` file parts.
2. `application/json` with an `attachments` array for agent-friendly delivery.

JSON attachment payloads support these fields per item:

- `fileName`: download name shown in the chat UI.
- `contentType`: optional MIME type. Defaults to `text/plain; charset=utf-8` for `text` and `application/octet-stream` for `base64Data`.
- `text`: UTF-8 text file contents.
- `base64Data`: binary file contents encoded as base64.

Example:

```json
{
	"content": "Attached the whitepaper.",
	"attachments": [
		{
			"fileName": "hisa_white_paper.md",
			"contentType": "text/markdown; charset=utf-8",
			"text": "# HISA\n\n..."
		},
		{
			"fileName": "chart.png",
			"contentType": "image/png",
			"base64Data": "iVBORw0KGgoAAAANSUhEUgAA..."
		}
	]
}
```

If your Hermes adapter is outside this repository, you can still exercise the sender side from here:

```bash
yarn post-assistant-message -- \
	--conversation 123e4567-e89b-12d3-a456-426614174000 \
	--content "Attached the whitepaper." \
	--file /tmp/hisa_white_paper.md
```

The helper script reads `HERMES_WEBCHAT_SERVICE_TOKEN` from the environment and posts JSON attachments to the internal assistant endpoint. Set `WEBUI_BASE_URL` if Hermes reaches the webui on a non-default address such as `http://webui:3000` inside Docker.
