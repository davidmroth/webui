# Hermes Agent - Development Guide

Instructions for AI coding assistants and developers working on the webui codebase (Hermes Web UI).

## Development Environment

```bash
docker compose  # This repo runs in a Docker container exclusively for consistency. See docker-compose.yml for details.
```

## Code Guidelines

Always follow the instructions in `./repo_guidelines`. This repo uses Docker Compose exclusively for development, so all code updates should be tested using the provided Docker Compose setup. Make sure to run the appropriate services and test your changes in the development environment before submitting a pull request.