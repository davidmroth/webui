# WebUI ↔ Hermes stability / E2E scripts

Operational helpers for validating the **WebUI → Hermes gateway → inference proxy → engine** path. These live in the `webui` repo (not `hermes-agent`) so the upstream Hermes tree stays clean.

The default prompt is an **AT&T (T) equity research brief** — a realistic multi-tool workload (web search, terminal curls, long context) used to stress-test turn completion, streaming, and WebUI delivery.

## Prerequisites

| Component | Notes |
|-----------|--------|
| **WebUI** | Running with `HERMES_WEBCHAT_SERVICE_TOKEN` set (matches Hermes `WEBCHAT_SERVICE_TOKEN`) |
| **Hermes gateway** | `webchat-platform` plugin enabled; `WEBCHAT_URL` points at WebUI |
| **Inference proxy** | Reachable from the Hermes container (not `127.0.0.1` unless gateway uses host networking) |

See [`plugin/README.md`](../plugin/README.md) for the WebChat adapter contract.

## Scripts

### `simulate-att-webui.sh` — full user-path E2E

Exercises the **real browser API flow**:

1. Log in with `BOOTSTRAP_USER_KEY` (WebUI owner API key)
2. Create a new conversation
3. `POST /api/conversations/{id}/messages` (queues Hermes inbox event)
4. Poll until Hermes posts an assistant reply

Run from a host with `curl`, `docker`, and network access to WebUI (e.g. ai.local):

```bash
export WEBCHAT_URL="https://your-webui.example.com"
export WEBCHAT_SERVICE_TOKEN="…"          # or read from Hermes container
export BOOTSTRAP_USER_KEY="…"             # WebUI BOOTSTRAP_USER_KEY (not dev default on prod)
# optional:
export STABILITY_PATCH_COMPRESSION=1      # lower Hermes compression.threshold 0.35→0.25
export STABILITY_WAIT_SEC=2700            # poll timeout (default 45 min)

./scripts/simulate-att-webui.sh
```

On success, prints `chat_url=…` — open that link while logged into WebUI.

### `run_att_webui_delivery.py` — agent + internal assistant POST

Alternative path when bootstrap login is unavailable (e.g. production WebUI with a non-default owner key):

1. Posts the prompt and status lines via **`POST /api/internal/hermes/conversations/{id}/assistant`** (service token)
2. Runs `AIAgent` inside the **Hermes container** against the inference proxy
3. Posts the final report to the same conversation

**Must run inside the Hermes gateway container** (`run_agent` import path):

```bash
docker cp scripts/run_att_webui_delivery.py hermes:/tmp/run_att_webui_delivery.py

docker exec -u hermes \
  -e WEBCHAT_URL="https://your-webui.example.com" \
  -e WEBCHAT_SERVICE_TOKEN="…" \
  -e WEBUI_CONVERSATION_ID="uuid-of-existing-conversation" \
  -e HERMES_BASE_URL="http://192.168.x.x:8000/v1" \
  -e HERMES_MODEL="qwen3.6-27b-autoround" \
  -w /opt/hermes hermes \
  /opt/hermes/.venv/bin/python -u /tmp/run_att_webui_delivery.py
```

**Important:** `HERMES_BASE_URL` must be reachable from inside the container. Bridge-networked Hermes cannot use `127.0.0.1:8000` for a proxy on the Docker host — use the host LAN IP or a compose service name.

### Environment reference

| Variable | Used by | Purpose |
|----------|---------|---------|
| `WEBCHAT_URL` | both | WebUI base URL |
| `WEBCHAT_SERVICE_TOKEN` | both | Bearer token (`HERMES_WEBCHAT_SERVICE_TOKEN` on WebUI) |
| `BOOTSTRAP_USER_KEY` | shell | WebUI login key for user API path |
| `WEBUI_CONVERSATION_ID` | python | Target conversation UUID |
| `HERMES_BASE_URL` | python | OpenAI-compatible proxy URL (`…/v1`) |
| `HERMES_API_KEY` | python | Proxy API key (default `llama.cpp`) |
| `HERMES_MODEL` | python | Model alias sent to proxy |
| `STABILITY_PROMPT` | both | Override default AT&T prompt |
| `STABILITY_MAX_ITERATIONS` | python | Agent tool loop cap (default `18`) |
| `STABILITY_PATCH_COMPRESSION` | shell | Set `1` to patch Hermes `compression.threshold` |
| `STABILITY_WAIT_SEC` | shell | Poll timeout for shell script |
| `HERMES_CONTAINER` | shell | Docker container name (default `hermes`) |

## Related WebUI tooling

- [`service/frontend/scripts/post-assistant-message.ts`](../service/frontend/scripts/post-assistant-message.ts) — post a static assistant message (no agent run)
- [`service/frontend/src/routes/api/internal/diagnostics/chat-probe/`](../service/frontend/src/routes/api/internal/diagnostics/chat-probe/) — maintenance-token chat probe API
- [docs/runbooks/agentlens-feedback-loop-sop-mop.md](../docs/runbooks/agentlens-feedback-loop-sop-mop.md) — operational loop for trigger-through-stack diagnosis and telemetry retrieval

## What to check when a run fails

- **503 / queue saturated** — only one inference slot; gateway and test script compete. Wait or pause other jobs.
- **502 on WebUI inbox** — Lightsail/WebUI container unhealthy; Hermes never receives the message.
- **Login 403** — `BOOTSTRAP_USER_KEY` mismatch; use `run_att_webui_delivery.py` instead.
- **Connection error to proxy** — wrong `HERMES_BASE_URL` from inside container.
- **Empty tool list, generic report** — agent completed without tool calls; verify `web`/`search`/`terminal` toolsets and API keys.

AgentLens (`/api/v1/benchmark/status`) and Hermes `state.db` help diagnose incomplete turns.
