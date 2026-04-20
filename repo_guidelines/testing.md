# Testing Standards

Testing requirements for the project. Covers the required test mix, high-value test categories, and platform-specific testing rules.

For the architectural context that motivates these rules, see [architecture.md](./architecture.md).

---

## Required Test Mix

Every service should have this default test mix:

| Category | Focus |
|---|---|
| Unit tests | Domain rules and pure logic |
| Contract tests | Shared schemas, event shapes, messaging behavior |
| Integration tests | Persistence, orchestration, service boundaries |
| Migration tests | Schema upgrade and downgrade correctness |
| Recovery tests | Restart, reconnect, and resume behavior |
| Regression tests | Bugs that escaped earlier phases |

---

## High-Value Test Categories

These categories should receive priority attention:

1. Config precedence
2. Backend authority enforcement
3. Serialization and deserialization
4. Timeout and retry behavior
5. Idempotency
6. Restart recovery
7. Failure mapping at transport boundaries
8. Migration upgrade and downgrade correctness

---

## Feature Completeness

- New features are not complete until **success, failure, and recovery paths** are covered.
- Every bug that reaches production or manual QA should result in a **regression test** when practical.
- Contract changes must be covered by contract tests.
- Restart, reconnect, timeout, retry, and idempotency behavior must be tested where applicable.

---

## Platform-Specific Testing

If the project uses WordPress or another opinionated platform, tests should verify that the implementation uses stable platform APIs correctly.

For WordPress projects:

- Verify use of `WP_Query`, taxonomy APIs, and post APIs over direct SQL.
- Verify business logic is not pushed into templates, shortcodes, or AJAX handlers.
- Verify options, transients, and post meta are not used as hidden control structures.
