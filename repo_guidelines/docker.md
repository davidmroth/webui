# Containerization & Deployment

Docker and deployment standards for the project. Covers Dockerfiles, compose base/override split, port exposure, secrets, multi-stage builds, and the manifest-driven deployment pipeline.

---

## Guiding Principle

Docker is the primary deployment artifact. If it does not run in Docker, it does not ship.

---

## File Structure

```text
project-root/
  docker-compose.yml              # base stack (services, deps, networks, env refs)
  docker-compose.override.yml     # per-repo dev overrides (host ports, debug, bind mounts)
  .env                            # secrets & credentials (git-ignored)
  .env.example                    # documents every required variable with safe placeholders
  backend/
    Dockerfile
  frontend/
    Dockerfile
  worker/
    Dockerfile
  infra/
    deploy/
      deploy.sh
      deploy.conf                 # manifest mapping services → deployment targets
      config/                     # per-service external config templates
```

---

## Dockerfiles

- Every deployable service must have a Dockerfile.
- Dockerfiles must use **multi-stage builds**: a build stage for dependencies and compilation, and a slim runtime stage that contains only what is needed to run.
- All images must target **`linux/amd64`** for cloud deployment compatibility.
- Production images must **not contain** development dependencies, test files, or source maps.

---

## Compose Base / Override Split

- **`docker-compose.yml`** defines the base stack: services, dependency relationships, volumes, networks, and environment variable references. No host-port mappings or hardcoded secrets.
- **`docker-compose.override.yml`** contains per-repo developer overrides: host-mapped ports, debug settings, volume bind-mount paths, and any configuration a developer might adjust. The override file should be **git-tracked** as the project default.
- `.env` provides per-machine variance.

---

## Local Development

- Local development must be runnable with a single **`docker compose up`** command.
- The compose file must include all required infrastructure services (database, cache, message broker) so developers never need to install service dependencies on the host.
- Development compose files should **mount source code as volumes** for hot-reload.
- Database and infrastructure services run in containers for local development only.
- The compose stack must run database migrations **before the backend accepts traffic**, typically via an entrypoint script or a dedicated init service — see [database.md](./database.md).

---

## Port Exposure Rules

- **Only expose ports to the host that developers need to access directly** (e.g., the frontend for browser access).
- Ports used only for inter-service communication within Docker's internal network **must not be mapped to the host**.
- Unnecessary host-port mappings create clashes with other Docker stacks and expose services that should remain private.

---

## Secrets and Environment Variables

- All secrets and credentials must live in **`.env`**, never hardcoded in compose files or Dockerfiles.
- Compose files must reference secrets exclusively through **`${VARIABLE}`** substitution.
- The `.env` file must be **git-ignored**.
- **`.env.example`** must document every required variable with safe placeholder values.

---

## Production Builds

- Production builds must **copy code into the image** (not mount volumes).
- Production deployments must use **managed database services** external to the container fleet.
- Production deployments must run database migrations as a **distinct step before the application starts**, not silently inside the app process — see [database.md](./database.md).
- Production images must not contain development dependencies, test files, or source maps.

---

## Manifest-Driven Deployment

- Deployment must be **manifest-driven**: a configuration file maps compose services to deployment targets.
- The deployment script must **read this manifest**, not embed service names or registry paths in code.
- Per-service deployment configuration (environment variables, resource limits, networking) must live in **external templates**, not inside the deployment script.
