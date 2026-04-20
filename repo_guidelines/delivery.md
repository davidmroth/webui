# Delivery Workflow

Delivery process for features. Covers the pre-flight checklist, starter decisions, step-by-step delivery workflow, and default bias.

---

## Pre-Flight Checklist

Before a feature is considered done, the team must be able to answer:

1. How does the backend establish and persist authority for the state this feature changes?
2. Where is classification performed, and what structured metadata do downstream consumers receive?
3. What is persisted, and what is intentionally ephemeral?
4. What happens if the process restarts in the middle of execution?
5. What contract or schema governs this feature across boundaries?
6. Where are transport, domain logic, persistence, and presentation separated?
7. Which regression test would fail if this behavior breaks later?
8. Does this feature require authentication? If so, which roles and permissions gate access, and are guards enforced at the backend boundary?
9. Does this feature require a database schema change? If so, is there a reviewed migration that runs as a distinct pre-application step?
10. Does the Dockerfile and compose configuration support this feature without manual host-level setup?

---

## Starter Decisions

Create these documents before writing code:

- `docs/architecture/authority-matrix.md`
- `docs/architecture/config-precedence.md`
- `docs/architecture/runtime-lifecycle.md`
- `docs/architecture/messaging-contracts.md`
- `docs/adr/0001-record-architecture-decisions.md`

Recommended additional governance files:

- `docs/architecture/classification-model.md`
- `docs/review/pr-checklist.md`

If these documents are missing, the project is likely to recreate the same ambiguity that made the current system expensive to evolve.

---

## Delivery Steps

For each new feature:

1. Add or update the authority matrix.
2. Define or extend the contract.
3. Define where classification happens and which structured fields consumers will receive.
4. Decide what is bootstrap, managed, and ephemeral state.
5. Define which roles and permissions gate access, and enforce guards at the backend boundary.
6. Write and review the database migration for any schema changes before implementing domain logic.
7. Implement domain logic behind a narrow interface.
8. Wire transport and UI layers to that interface.
9. Verify the Dockerfile and compose configuration support the feature without manual host-level setup.
10. Add regression and recovery tests before marking the feature done.

---

## Review Triggers

Require explicit review and likely refactoring when a change introduces:

- a second apparent writer for backend-authoritative state,
- duplicated classification logic,
- consumer-side parsing of backend messages,
- a page or component that absorbs network, business, and presentation concerns at once,
- a large method or module that mixes multiple responsibilities,
- hidden precedence rules or state encoded in loosely structured metadata.

---

## Default Bias

When tradeoffs are unclear, choose the design that is:

- easier to reason about after a restart,
- easier to verify with tests,
- and harder to misuse across system boundaries.

When constraints prevent the ideal design, call that out explicitly, explain the tradeoff, and propose the cleanest acceptable fallback. Do not smuggle technical debt in as if it were a principled solution.
