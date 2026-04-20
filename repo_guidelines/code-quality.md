# Code Quality

Coding standards for the project. Covers DRY, naming, small units, nesting, error handling, observability, size thresholds, and prohibited shortcuts.

For architectural principles behind these standards, see [architecture.md](./architecture.md).

---

## General Principles

- Prefer small modules with one obvious responsibility.
- Use descriptive names for files, functions, and state objects.
- Do not hide control flow in convenience helpers that obscure side effects.
- Prefer intention-revealing domain names over vague placeholders.
- Avoid burying logic inside loops, callbacks, conditionals, templates, or configuration blobs.
- Code should read like a description of the domain, not like a record of workarounds.

---

## DRY — Done Properly

- DRY means extracting focused behavior into helpers, services, DTOs, value objects, repositories, commands, or queries.
- DRY does not mean copy-paste with minor edits.
- Extract reusable behavior via small focused helpers, service classes, and clear abstractions.

---

## Naming

- **Intention-revealing names** — no `$data`, `$result`, `$x`, `$temp`, `$arr`.
- **Verb-noun for actions** — `calculate_total()`, `normalize_email()`, `classify_outcome()`.
- **Predicate names for booleans** — `is_recoverable()`, `has_user_facing_hint()`.
- **Consistent terminology** across the entire project and API surface.
- Logic that is hard to name cleanly is usually logic that should be moved or split.

---

## Small Units

- Functions or methods that push beyond roughly **25–35 effective lines** (excluding blank lines and braces) should trigger review for extraction.
- Large files are a warning sign, not evidence of productivity.
- Massive god-functions and god-classes are not acceptable design tradeoffs.

For frontend-specific size limits, see [frontend.md](./frontend.md#size-limits).

---

## Nesting and Control Flow

- Prefer guard clauses, early returns, and decomposition over deep nesting.
- Avoid deep conditional chains — extract subordinate logic into well-named functions.

---

## Typing

- Pick one typing strategy early and apply it consistently.
- Backend and worker boundaries should use typed request and response schemas.
- Frontend should prefer TypeScript for shared contracts and state-heavy domains.
- If plain JavaScript is used, runtime schema validation is required at boundaries.
- Type safety should be used where the language and framework allow it.

---

## Error Handling and Input Defense

- Validate and sanitize at architectural boundaries, not opportunistically throughout the codebase.
- Use specific domain exceptions or structured error objects instead of generic failures.
- Never require downstream consumers to parse error text — see [Classify Once](./architecture.md#classify-once-consume-structured-metadata).
- Never swallow exceptions silently unless the behavior is explicitly required and logged.
- Provide context-rich developer diagnostics and user-appropriate messages without leaking sensitive implementation detail.
- Fail at boundaries with clear, structured errors.
- Convert low-level errors into domain-relevant outcomes before exposing them upward.
- Log structured diagnostic context server-side.

---

## Documentation

- Public interfaces and framework-integrated entry points should have concise API documentation.
- Inline comments should explain **why** a decision exists, not **what** the code is doing.
- If a line needs a comment to explain what it does, prefer renaming or refactoring first.
- Add comments only when the code would otherwise be hard to reason about.

---

## Observability

- Every background process should emit lifecycle logs.
- Command execution should be traceable with correlation IDs.
- Distinguish between operator-facing warnings and developer-facing debug logs.

---

## Prohibited Shortcuts

Strongly discourage and avoid:

- regex-based parsing, HTML scraping, and string-manipulation hacks as core control flow,
- brittle prefix, suffix, split, contains, startsWith, endsWith, or regex checks used to classify or route behavior,
- repeated logic copied with small edits,
- 200–600 line god-functions or god-classes with mixed responsibilities,
- logic buried in conditionals, loops, callbacks, templates, or configuration blobs,
- hidden control structures encoded in persistence primitives instead of proper domain objects,
- inline JavaScript or CSS in PHP except for tiny, clearly justified fragments,
- global variables except rare, well-documented platform globals,
- direct database queries when a stable platform API already exists,
- rendering action-dense toolbars or bulk-operation surfaces unconditionally when visibility should depend on selection state, data presence, or workflow stage — see [Progressive Disclosure](./frontend.md#progressive-disclosure-and-contextual-visibility),
- duplicating per-row action buttons that are redundant with available bulk actions in a multi-select context.

---

## Reject Quick Fixes

Reject or push back clearly when the proposal sounds like any of the following:

- "We can just regex it for now."
- "It is only used in one place, so duplication is fine."
- "It is ugly but it works."
- "We will refactor it later."
- "This is temporary or only for one client."
- "This one large method is easier than introducing structure."

**Response pattern when rejecting:**

> While this regex, string-parsing, or frontend-classification approach solves the current case, it is brittle and will break when wording changes, new cases are added, data shape evolves, or another client consumes the same behavior.
> A more robust solution is to move the logic into the backend or domain layer, classify the outcome once, return structured metadata, and expose the result through a narrow contract that is easier to test and maintain.

---

## Platform Constraints

If the project runs on WordPress or another opinionated platform, use its stable APIs before bypassing them.

For WordPress projects:

- prefer `WP_Query`, taxonomy APIs, post APIs, and other supported interfaces over direct SQL,
- avoid using transients, options, or post meta as hidden control structures when a real domain model is warranted,
- avoid business logic inside templates, shortcodes, AJAX handlers, or inline snippets.
