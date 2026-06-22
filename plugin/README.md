# Hermes WebUI integration plugin

All Hermes-side WebUI integration lives in this directory:

| File | Role |
| --- | --- |
| `adapter.py` | Gateway platform adapter (reverse-poll WebUI inbox) |
| `gateway_hooks.py` | Session reconciliation, status buffering, transcript streaming, trusted auth |
| `tools.py` | `send_file_to_webchat`, `send_html_to_webchat` |
| `plugin.yaml` | Plugin manifest + env metadata |

Hermes core now exposes **generic** `GatewayPlatformHooks` on `PlatformEntry` — no WebUI-specific branches remain in `gateway/run.py` beyond hook dispatch.

## Docker mount (hermes-agent)

```yaml
# hermes-agent/docker-compose.override.yml
- ../webui/plugin:/opt/data/plugins/webchat-platform:ro
```

Enable once:

```bash
docker compose exec gateway hermes plugins enable webchat-platform
```

## Environment

| Variable | Purpose |
| --- | --- |
| `WEBCHAT_ENABLED` | Auto-enable platform |
| `WEBCHAT_URL` | WebUI base URL (`http://webui:3000` on compose network) |
| `WEBCHAT_SERVICE_TOKEN` | Shared bearer token (matches WebUI `HERMES_WEBCHAT_SERVICE_TOKEN`) |
| `WEBCHAT_PUBLIC_BASE_URL` | Public URL for download links |
| `WEBCHAT_HOME_CHANNEL` | Default conversation for cron `deliver=webui` |

## API contract

Routes under `service/frontend/src/routes/api/internal/hermes/` — change adapter + hooks in the same PR when the contract changes.
