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

- Attachment upload/download flows.
- Streaming assistant chunks in the browser.
- Rich message actions and llama.cpp UI feature parity.
- Durable retry leasing for Hermes events beyond the initial queue/ack path.

## Local development

1. Copy `.env.example` to `.env` and change at minimum `HERMES_WEBCHAT_SERVICE_TOKEN` and `BOOTSTRAP_USER_KEY`.
2. `BOOTSTRAP_USER_KEY` is the browser login key for the bootstrap owner account. `HERMES_WEBCHAT_SERVICE_TOKEN` is only for internal service-to-service authentication.
3. The bootstrap owner record is kept in sync with `BOOTSTRAP_USER_NAME` and `BOOTSTRAP_USER_KEY`, so changing those values updates the bootstrap login instead of only applying on first database initialization.
4. Run `docker compose up --build` from this directory.
5. Open `http://localhost:3000` by default, or use whatever value you set for `WEBUI_PORT` in `.env`. If you access the dev server through a custom hostname such as `ai.local`, add it to `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` in `.env`. The exposed MySQL and MinIO ports are also configurable there.
6. Sign in with the bootstrap key from `.env`.

The app runs versioned database migrations and records them in `schema_migrations`. Existing MySQL volumes are upgraded automatically on startup, and you can also run them explicitly during deploys with `docker compose exec webui npm run migrate`. If you run the CLI from the host shell instead, override `DATABASE_HOST` and `DATABASE_PORT` to point at the exposed MySQL port.

## Service contract

Hermes uses the `webchat` adapter to poll:

- `GET /api/internal/hermes/health`
- `GET /api/internal/hermes/inbox/next`
- `POST /api/internal/hermes/events/:id/ack`
- `POST /api/internal/hermes/conversations/:id/assistant`

The browser never sees the Hermes service token.
