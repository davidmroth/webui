# Hermes WebChat platform plugin

This directory is the **Hermes gateway adapter** for the WebUI. It lives in the WebUI repo so the HTTP contract and adapter stay in one place.

## Install (Docker dev with hermes-agent)

Hermes loads user plugins from `~/.hermes/plugins/`. In `hermes-agent/docker-compose.override.yml` this folder is mounted read-only:

```yaml
- ../webui/plugin:/opt/data/plugins/webchat-platform:ro
```

Enable once per profile:

```bash
docker compose exec gateway hermes plugins enable webchat-platform
```

Or add to `~/.hermes/config.yaml`:

```yaml
plugins:
  enabled:
    - webchat-platform
```

## Environment

Set on the **gateway** (and match `HERMES_WEBCHAT_SERVICE_TOKEN` on the WebUI):

| Variable | Purpose |
| --- | --- |
| `WEBCHAT_ENABLED` | Auto-enable platform (`true` / `1` / `yes`) |
| `WEBCHAT_URL` | WebUI base URL (e.g. `http://webui:3000` on compose network) |
| `WEBCHAT_SERVICE_TOKEN` | Shared bearer token (same as WebUI `HERMES_WEBCHAT_SERVICE_TOKEN`) |
| `WEBCHAT_PUBLIC_BASE_URL` | Public URL for download links in chat |
| `WEBCHAT_HOME_CHANNEL` | Default conversation ID for cron delivery |

## WebUI API contract

The adapter polls and posts against `/api/internal/hermes/*` routes implemented under `service/frontend/src/routes/api/internal/hermes/`. When you change those routes, update `adapter.py` here in the same PR.

## Tests

Hermes integration tests import this plugin from the sibling checkout:

```bash
# From hermes-agent (expects ../webui/plugin)
docker compose run --rm gateway scripts/run_tests.sh tests/gateway/test_webchat.py -q
```

Override path when the WebUI repo is elsewhere:

```bash
export WEBUI_PLUGIN_PATH=/path/to/webui/plugin
```
