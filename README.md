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
2. Run `docker compose up --build` from this directory.
3. Open `http://localhost:3000` by default, or use whatever value you set for `WEBUI_PORT` in `.env`. The exposed MySQL and MinIO ports are also configurable there.
4. Sign in with the bootstrap key from `.env`.

## Service contract

Hermes uses the `webchat` adapter to poll:

- `GET /api/internal/hermes/health`
- `GET /api/internal/hermes/inbox/next`
- `POST /api/internal/hermes/events/:id/ack`
- `POST /api/internal/hermes/conversations/:id/assistant`

The browser never sees the Hermes service token.
