# Hermes Agent - Development Guide

Instructions for AI coding assistants and developers working on the webui codebase (Hermes Web UI).

## Development Environment

```bash
docker compose  # This repo runs in a Docker container exclusively for consistency. See docker-compose.yml for details.
```

## Hermes gateway plugin

The reverse-polling WebChat adapter ships in `plugin/` (mounted into Hermes at `~/.hermes/plugins/webchat-platform`). See `plugin/README.md` for env vars and docker mount setup.

## Code Guidelines

Always follow the instructions in `./repo_guidelines`. This repo uses Docker Compose exclusively for development, so all code updates should be tested using the provided Docker Compose setup. Make sure to run the appropriate services and test your changes in the development environment before submitting a pull request.

## Always adhear to the following principles:
./repo_guidelines/donotdo.md

## Lightsail deploy (OpenCode agent)

Platform Docker/AWS rules live in the OpenCode **global** `AGENTS.md` (AWS CLI via `amazon/aws-cli` container + filtered docker proxy). In this repo:

1. Put the temporary `/tmp/bin/aws` wrapper on `PATH` (see global AGENTS.md).
2. `jq` is already available in the OpenCode agent image.
3. Build, push, and deploy:

```bash
cd /data/projects/ai/webui   # or this repo root when already cwd
./infra/deploy/lightsail.sh -bpz --config deploy.conf --compose-service webui --service webui
```

Local compose (LAN Hermes WebUI) when needed:

```bash
docker compose up -d --build webui
```

Do not invent alternate deploy hosts or raw-socket workarounds — report the actual docker/aws error.
