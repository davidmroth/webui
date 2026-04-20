# Architecture

Core design principles for the project. This file defines authority, trust, classification, configuration, contracts, separation of concerns, layer structure, ownership, and the recommended repo layout.

## Operating Stance

- The backend is the only trusted authority for business state.
- All other layers are zero-trust participants: they may observe, request, suggest, cache, or execute, but they do not establish truth.
- Prefer principled, durable solutions over quick fixes that only satisfy the current case.
- If a proposed implementation works only because wording, markup, sequence, or structure happens to look a certain way today, treat it as a design failure, not a shortcut.

## Core Principles

1. The backend is the authority for every important piece of business state.
2. Runtime behavior must be recoverable after restart.
3. Shared contracts must be defined before multi-service features ship.
4. UI code should assemble behavior, not own business rules.
5. Configuration must be explicit, typed, and precedence-driven.
6. Code should be intention-revealing, modular, and structured around domain concepts.
7. Tests should protect invariants and regressions, not just happy paths.
8. Classification happens once in the backend or domain layer and is consumed as structured metadata everywhere else.
9. Principled, extensible designs are preferred over quick fixes that only satisfy the current case.

---

## System Authority

- The backend is the only trusted authority for mutable business state.
- Devices, frontend clients, and background workers may observe, cache, or propose state changes, but they may not become authoritative.
- Inputs from devices, workers, and clients must be treated as untrusted until validated, reconciled, and persisted by the backend.
- If a field appears writable from more than one layer, the non-backend write path must be modeled as a request, event, or proposal that the backend accepts or rejects.

### Ownership Model

Before implementation starts, define an authority matrix in `docs/architecture/authority-matrix.md`.

Use this shape:

```md
| Domain Object        | Authority | Writers Allowed        | Readers                | Recovery Source |
|---------------------|-----------|------------------------|------------------------|-----------------| 
| Device environment  | Backend   | Backend only           | Backend, worker, UI    | DB + snapshot   |
| Runtime execution   | Backend   | Backend only           | Backend, worker, UI    | DB + runtime log|
| Analytics aggregate | Backend   | Backend only           | UI, reports            | DB              |
| Display status      | Backend   | Backend publishes only | UI                     | Latest event    |
```

Rules:

- If a domain object has no row in the authority matrix, it is not ready to build.
- Non-backend systems may emit observations or requested mutations, but the backend is the only layer that confirms truth.
- If two layers appear to need write access, the design is incomplete until the non-backend path is reframed as backend-validated input.
- UI code never becomes authoritative for business state.

---

## Classify Once, Consume Structured Metadata

Classification, categorization, semantic interpretation, and outcome typing must happen exactly once in the authoritative backend or domain layer.

**Required backend output for meaningful outcomes:**

- a stable machine-readable type or code,
- optional category and severity fields,
- optional recoverability or action-required flags,
- optional user-facing hint keys,
- optional developer diagnostics kept separate from user messaging.

**Consumer rules:**

- UI, workers, and downstream services must read structured metadata directly.
- Consumers must not parse free-form messages to determine behavior.
- Message wording is presentation, not control flow.
- Message wording may change. Structured semantics must not.

**Reject immediately:**

- frontend logic like `message.includes(...)`, `startsWith(...)`, `endsWith(...)`, or regex checks to decide behavior,
- backend responses that return only human-readable error text without structured type or code,
- multiple clients reimplementing the same classification logic,
- `includes`, `startsWith`, `endsWith`, `split`, regex, or similar checks used to classify business outcomes.

---

## Configuration Model

Configuration must be split into three classes.

### 1. Bootstrap Config

Used to start the process.

Examples: service ports, database DSN, broker address, file paths, credentials references.

Properties:

- loaded at process start,
- validated with typed schemas,
- controlled by deployment or operator input,
- not overwritten by runtime messages.

### 2. Managed Runtime Settings

Used to alter behavior after the process starts.

Examples: polling intervals, feature flags, environment snapshots, schedule snapshots.

Properties:

- persisted separately from bootstrap config,
- owned by the backend as authority,
- replayable after restart,
- versioned if structure evolves.

### 3. Ephemeral Runtime State

Used only to reflect current execution.

Examples: active execution IDs, in-flight command state, websocket connection status, temporary caches.

Properties:

- may be in memory,
- must be rebuildable or intentionally disposable,
- must not be confused with configuration,
- must not be mistaken for backend-authoritative business state.

**Rules:**

- Bootstrap configuration and runtime-managed state must live separately.
- Environment variables may seed local development, but they must not override persisted operator-managed settings unless explicitly declared.
- Configuration must be validated at process start with typed schemas.
- Every persisted setting must have a documented precedence order.

---

## Contracts Between Services

All cross-process communication belongs in `contracts/`.

**Required contents:**

- typed message schemas,
- topic builders or route constants,
- command and event enums,
- correlation ID rules,
- timeout and retry semantics,
- contract tests,
- version notes for breaking changes.

**Rules:**

- All inter-service payloads, message topics, event shapes, and request-response semantics must live in a shared contract package or schema module.
- No service may define its own private copy of shared payload shapes.
- Contracts must be versioned when breaking changes are introduced.
- Correlation IDs, failure semantics, and timeout behavior must be part of the contract, not caller convention.
- Contracts must expose structured, machine-readable semantics rather than forcing consumers to interpret prose.
- Unknown or invalid contract data must fail loudly at the boundary.

---

## Separation of Concerns and Single Responsibility

- Separation of concerns is mandatory: presentation, domain logic, persistence, external integration, and cross-cutting concerns must live in separate layers or modules.
- Single responsibility is mandatory: each class, function, and module should have one clear reason to change.
- High cohesion and loose coupling are the default: related behavior belongs together; unrelated behavior communicates through narrow, stable interfaces.
- Depend on abstractions and contracts, not concrete implementation details.
- Prefer extensible designs that can grow by adding new strategies, handlers, repositories, commands, queries, or decorators instead of modifying sprawling conditional logic.
- Prefer configuration and explicit extension points over hard-coded branches.

### Simplicity and Boundaries

- Keep modules small enough that a new engineer can understand their responsibility quickly.
- Prefer a few strong abstractions over many overlapping helpers.
- Do not merge unrelated concerns into the same file because they happen to run in the same process.
- When a module becomes hard to reason about, refactor before layering on more behavior.

---

## Backend Structure

```text
backend/src/
  app/
    api/
      routes/
      schemas/
      dependencies/
    domain/
      [feature]/
        models/
        service/
        permissions/
    services/
    repositories/
    events/
    config/
    startup/
    observability/
  main.py
  migrations/
    versions/
    config.<ext>
```

- `api/` owns HTTP and WebSocket entry points.
- `domain/` owns business rules.
- `services/` owns orchestration across domain and infrastructure.
- `repositories/` owns persistence.
- `startup/` owns boot wiring only.
- `config/` owns typed settings and precedence logic.

**Rules:**

- Route handlers should validate input, call a service, and return a response.
- Domain logic must not depend on HTTP or framework objects.
- The backend must validate and persist authoritative state transitions before other layers treat them as true.
- Domain and service layers should classify outcomes once and emit structured metadata.
- Startup code should be minimal and deterministic.
- Migrations must run as a distinct pre-application step, not silently inside the app server's startup code — see [database.md](./database.md).
- One-time repair jobs and background jobs should not be silently coupled to request-serving startup unless there is a documented reason.
- Every background listener or scheduler must define startup, shutdown, retry, and recovery behavior.
- Prefer explicit services, repositories, commands, queries, strategies, or decorators over sprawling conditionals.
- Application startup must be deterministic and minimal.
- Request-serving processes should not own unrelated deploy-time duties unless there is a clear operational reason.

---

## Frontend

See [frontend.md](./frontend.md) for frontend structure, rules, size limits, iconography, progressive disclosure, and bundle hygiene guidelines.

---

## Worker / Device-Service Structure

```text
worker/src/
  runtime/
  jobs/
  handlers/
  persistence/
  config/
```

- `handlers/` translate incoming commands into domain actions.
- `runtime/` manages loops, scheduling, and lifecycle.
- `persistence/` manages durable snapshots and replay state.
- `config/` manages typed startup configuration and precedence.

**Rules:**

- Worker and device services must export observations and execution facts in a form the backend can validate and persist.
- Worker-local runtime state is operational, not authoritative.
- Background workers and device-side services execute work, but the backend owns the durable record of what is true.
- Workers must not become the place where business truth is inferred from loosely structured text.
- If a task must survive restart, persist the minimum state needed to recover it.
- Long-running jobs, schedulers, and transport listeners must define lifecycle, retry, and shutdown behavior explicitly.
- Side effects must be idempotent wherever retries or reconnects are possible.
- Domain logic must not be buried inside handlers, loops, callbacks, or transport glue.
- Retries must be bounded and observable.
- Transport errors must be mapped to explicit command outcomes.
- Caches must be invalidated on writes or be clearly read-only.

---

## Recovery and Resilience

- Every background workflow must specify what happens on restart, reconnect, timeout, duplicate delivery, and partial failure.
- If a workflow matters after reboot, its state must be persisted intentionally.
- Systems must prefer replayable events and durable state over implicit in-memory assumptions.

---

## Recommended Repository Layout

```text
project-root/
  README.md
  docs/
    architecture/
      authority-matrix.md
      runtime-lifecycle.md
      config-precedence.md
      messaging-contracts.md
    adr/
      0001-record-architecture-decisions.md
    runbooks/
      local-development.md
      deployment.md
      incident-recovery.md
  contracts/
    README.md
    src/
      events/
      commands/
      schemas/
      topics/
      versions/
    tests/
  backend/
    migrations/
    ...
  frontend/
    ...
  worker/
    ...
  infra/
    docker/
    deploy/
      deploy.sh
      deploy.conf
      config/
    env/
    scripts/
  tools/
    checks/
    generators/
  .github/
    workflows/
```
