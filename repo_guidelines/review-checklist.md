# PR Review Checklist

Use this checklist to review pull requests. A PR should not merge while any blocking item remains unresolved. Each section references the relevant guideline file for full rationale.

---

## Authority and Trust → [architecture.md](./architecture.md)

- [ ] The backend remains the only trusted authority for business state.
- [ ] Any device, worker, or client write path is modeled as backend-validated input rather than direct authority.
- [ ] The change does not introduce a second apparent writer for a backend-authoritative field.
- [ ] Recovery and persistence rules still make the backend the durable record of truth.

## Classification and Contracts → [architecture.md](./architecture.md)

- [ ] Outcome classification happens in the backend or domain layer, not in the UI or another consumer.
- [ ] Responses and events expose stable machine-readable fields for type, code, severity, category, or recoverability where needed.
- [ ] No consumer has to parse free-form text to decide behavior.
- [ ] Shared payload shapes, enums, and message semantics live in the contract layer rather than being copied locally.
- [ ] Breaking contract changes are versioned and documented.

## Architecture and Boundaries → [architecture.md](./architecture.md)

- [ ] Presentation, domain logic, persistence, and integration concerns remain separated.
- [ ] Route handlers or controllers remain thin and delegate to services or domain modules.
- [ ] Business logic is not buried in templates, callbacks, loops, handlers, or transport glue.
- [ ] The change improves or preserves cohesion and does not tighten unnecessary coupling.
- [ ] New extensibility needs are addressed with clear abstractions rather than conditional sprawl.

## Code Quality → [code-quality.md](./code-quality.md)

- [ ] The implementation avoids regex, string parsing, prefix checks, suffix checks, split logic, or HTML scraping as business control flow.
- [ ] The change does not duplicate existing logic with minor edits.
- [ ] Naming is intention-revealing and uses consistent domain terminology.
- [ ] Functions, methods, and modules remain reasonably small and focused.
- [ ] The change does not expand a god-function or god-class instead of decomposing it.

## Frontend → [architecture.md](./architecture.md)

- [ ] UI code does not make ad hoc network calls when an existing service or hook boundary should be used.
- [ ] UI behavior is driven by structured backend-authoritative data, not guessed from text.
- [ ] Pages and components are composing domain logic rather than absorbing it.
- [ ] Real-time behavior uses backend-authoritative events and does not trust raw device claims directly.
- [ ] Action buttons, bulk toolbars, and contextual controls render only when the user has created the state that makes them meaningful (e.g., items are selected, data exists) — see [Progressive Disclosure](./frontend.md#progressive-disclosure-and-contextual-visibility).
- [ ] Per-row action buttons are not duplicated when an equivalent bulk action is available via multi-select.

## Backend and Workers → [architecture.md](./architecture.md)

- [ ] Backend state transitions are validated and persisted before other layers treat them as true.
- [ ] Workers emit observations and execution facts in a form the backend can validate.
- [ ] Long-running jobs define startup, shutdown, retry, and recovery behavior.
- [ ] Side effects are idempotent or otherwise safe under retry and reconnect conditions.

## Configuration and State → [architecture.md](./architecture.md)

- [ ] Bootstrap config, managed runtime settings, and ephemeral state remain clearly separated.
- [ ] No hidden precedence rule was introduced.
- [ ] Environment variables do not silently override persisted operator-managed settings.
- [ ] Durable workflows do not rely solely on in-memory state.

## Errors and Validation → [code-quality.md](./code-quality.md)

- [ ] Validation and sanitization happen at boundaries.
- [ ] Errors are represented with specific domain failures or structured error objects.
- [ ] Exceptions are not swallowed silently.
- [ ] Logs and diagnostics contain enough context for debugging without leaking sensitive data to users.

## Testing → [testing.md](./testing.md)

- [ ] The change includes or updates tests for the relevant invariant, regression, or failure mode.
- [ ] Success, failure, and recovery paths are covered where the feature matters.
- [ ] Contract changes are covered by contract tests.
- [ ] Restart, reconnect, timeout, retry, or idempotency behavior is tested where applicable.

## Authentication and Access Control → [auth.md](./auth.md)

- [ ] The backend is the sole authority for identity, roles, and permissions.
- [ ] Permission checks happen at the route or service boundary via explicit guards, not scattered conditionals.
- [ ] Adding a new role requires only a mapping entry, not changes to guard logic or every protected route.
- [ ] Frontend role and permission checks are for UI visibility only and are not used as security boundaries.
- [ ] Token issuance, validation, and revocation happen exclusively in the backend.
- [ ] Password hashing uses an isolated, dedicated service.
- [ ] Admin seeding is part of the bootstrap lifecycle, not manual database inserts.

## Containerization and Deployment → [docker.md](./docker.md)

- [ ] Every deployable service has a Dockerfile with multi-stage builds (build stage + slim runtime).
- [ ] `docker compose up` runs the full local stack without host-level service dependencies.
- [ ] Development compose mounts source code for hot-reload; production images copy code in.
- [ ] All images target `linux/amd64`.
- [ ] Database and infrastructure services run in containers locally but use managed services in production.
- [ ] Deployment is manifest-driven: service mappings live in a config file, not hardcoded in scripts.
- [ ] Per-service deployment configuration lives in external templates.
- [ ] Production images do not contain dev dependencies, test files, or source maps.
- [ ] Ports mapped to the host are only those that developers need to access directly. Internal-only service ports are not exposed.
- [ ] `docker-compose.yml` defines the base stack; `docker-compose.override.yml` contains per-repo overrides.
- [ ] All secrets and credentials live in `.env` (git-ignored), never hardcoded in compose files. `.env.example` documents every required variable.

## Database Migrations → [database.md](./database.md)

- [ ] Schema changes are captured in a reviewed migration, not manual DDL.
- [ ] Each migration represents a single logical schema change.
- [ ] Autogenerated migrations have been reviewed and adjusted before commit.
- [ ] Data-destructive operations have a documented downgrade path or explicit justification for irreversibility.
- [ ] Migrations run as a distinct pre-application step, not silently inside the app server.
- [ ] The migration chain is linear and produces the same result in dev, CI, staging, and production.
- [ ] Migration files are immutable after merge — fixes go in a new migration.

## Platform-Specific Review

For WordPress projects:

- [ ] The change uses proper WordPress APIs before falling back to direct SQL.
- [ ] Business logic is not pushed into templates, shortcodes, or AJAX handlers.
- [ ] Options, transients, or post meta are not being used as hidden control structures.
- [ ] Inline JavaScript or CSS in PHP is avoided unless the use is tiny and explicitly justified.

---

## Reviewer Pushback Prompts

Use these prompts when a PR drifts into quick-fix territory:

- This appears to solve the current case by parsing text or structure that is not guaranteed to stay stable. Can we move the classification into the backend and return structured metadata instead?
- This adds another place where the same logic is inferred. Can we centralize that logic behind a service, contract, or domain object?
- This expands a large module further. What extraction would make the responsibility boundary clearer?
- This relies on behavior that works for one client or one test case. What makes it safe when requirements evolve or another consumer appears?
- This permission check only exists on the frontend. What prevents a direct API call from bypassing it?
- This change requires a new dependency or service on the host. Can it run inside the existing Docker Compose stack instead?
- This port is mapped to the host but only used for inter-service communication. Can it stay internal to the Docker network?
- This secret is hardcoded in the compose file. Should it be in `.env` instead?

---

## Merge Bar

A PR is ready to merge when:

- all blocking checklist items are satisfied,
- any deliberate deviation from the guidelines is explicitly documented,
- the tradeoff is visible to reviewers,
- and the code is still likely to be understandable and correct when the next developer changes it under different requirements.
