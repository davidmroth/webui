# Frontend

Frontend-specific structure, rules, and quality standards. For cross-cutting architectural principles, see [architecture.md](./architecture.md). For general code quality standards, see [code-quality.md](./code-quality.md).

---

## Structure

```text
frontend/src/
  app/
    router/
    providers/
  domains/
    [feature]/
      components/
      hooks/
      services/
      state/
      types/
  shared/
    components/
    hooks/
    lib/
    services/
    styles/
```

- `domains/` owns feature-specific UI and logic.
- `shared/services/` owns network clients and common transport helpers.
- `hooks/` own stateful orchestration.
- `components/` focus on rendering and interaction.

---

## Rules

- Components may render and coordinate interactions, but business logic, API access, and transport concerns belong in hooks, services, or domain modules.
- No direct `fetch` or ad hoc transport logic inside pages or feature components.
- All server access goes through service modules or hooks.
- Real-time events consumed by the UI should come from backend-authoritative streams, not directly trusted device claims.
- UI code must not parse backend text to determine type, severity, state, or recoverability — see [Classify Once](./architecture.md#classify-once-consume-structured-metadata).
- Bootstrap loading, mutations, and event handling must remain distinguishable.
- Pages should compose domain hooks and components, not absorb business workflows.
- Business rules do not belong in templates, callbacks, or view files.
- Any component or page that grows beyond a reasonable size must be split by domain responsibility before new features are added.

---

## Size Limits

Review thresholds, not formatting targets:

| Unit | Threshold |
|---|---|
| Components | 300 lines |
| Hooks | 200 lines |
| Pages | 400 lines |

---

## Iconography and Visual Indicators

- **No emoji in UI.** Emoji render inconsistently across operating systems, browsers, and devices, cannot be styled (color, size, stroke) to match the design system, and look unprofessional in product interfaces. Do not use emoji as icons, status indicators, labels, or decorative elements in any user-facing surface.
- **Use clean, theme-aligned SVG graphics.** All icons must be inline SVGs or sourced from a shared icon component / sprite set so they inherit theme colors, scale cleanly, and remain visually consistent across the application.
- Icon assets should live in a shared location (e.g., `shared/components/icons/` or a centralized sprite file) and be referenced by component name, not inlined repeatedly.
- Emoji are acceptable only in non-UI developer contexts (commit messages, CLI output, internal logs) where visual consistency is not a concern.

---

## Progressive Disclosure and Contextual Visibility

Controls, actions, and bulk-operation surfaces must not render until the user has created the state that makes them meaningful. Showing every possible action at all times creates cognitive overload and obscures the actions that actually matter right now.

**Selection-driven actions:**

- When a list, table, or widget supports item selection (checkboxes, multi-select), action buttons such as delete, export, assign, or move must remain hidden until at least one item is selected.
- A "Select All" checkbox follows the same rule — bulk action buttons appear only after selection exists.
- When selection is cleared (manually or by navigation), the action surface must disappear again.

**Bulk vs. per-row action deduplication:**

- When multi-select is available, row-level action buttons that duplicate the bulk action are unnecessary noise.
- If a bulk "Delete" button appears on selection, individual rows should not also show a standalone "Delete" button. The row should expose only a selection checkbox and any row-specific actions that cannot be performed in bulk (e.g., "Edit", "View Details").
- Row-level actions are acceptable only for operations that are inherently single-item or contextually distinct from what the bulk action provides.

**Empty-state and zero-data visibility:**

- Action bars, filters, and bulk tools must not render when there is no data to act on.
- Show an empty-state message with a clear primary action (e.g., "Create your first item") instead.

**Implementation pattern:**

- Contextual visibility must be driven by reactive state (e.g., `selectedCount > 0`), not by CSS `display` toggling that leaves DOM nodes present but hidden.
- Prefer conditional rendering so the DOM reflects only what the user can act on.
- Contextual visibility logic must live in a composable hook or shared utility, not be reimplemented ad hoc in every component that needs it.

**Reject immediately:**

- rendering a full action toolbar on page load with every button disabled,
- showing identical per-row and bulk action buttons simultaneously,
- static action bars that never change regardless of selection or data state,
- CSS-only hiding of actions that are not yet meaningful.

---

## Client-Side Bundle Hygiene

Ship only what the current page needs. Every byte of client-side code that does not serve the active route is wasted bandwidth, parse time, and attack surface.

**Server-first page composition:**

- Page-level route or entry files should remain server-rendered or static.
- Push the client or interactive boundary to the smallest leaf component that actually requires browser APIs, state, or event handlers.
- Marking an entire page as client-side drags all of its imports — including utilities, types, and transitive dependencies — into the browser bundle.

**Lazy-load non-critical root-level components:**

- Any component mounted in the application shell or root layout that is conditional, feature-flagged, admin-only, or reads from browser-only storage must be loaded on demand (dynamic import, lazy load, or code-split).
- Statically importing it forces it into every route's initial bundle.
- Exception: core providers required by every page (auth, theme, i18n) should remain statically imported to avoid hydration mismatches or missing-context flashes.

**Explicit prefetch and preload control:**

- On pages that should be minimal (auth, error, maintenance), disable any framework-default route prefetching on outbound links.
- Default prefetch pulls the full dependency tree of the target page into the current page's network and parse budget.

**Isolate heavy dependencies to consuming routes:**

- Large packages (markdown renderers, charting libraries, PDF viewers, rich-text editors, code editors) must be imported only in the component that uses them.
- They must never appear in shared layouts, shared utility modules, or re-export barrels.
- Audit by searching for the package name across the codebase and confirming every import site is under the specific route that needs it.

**No re-export barrels that aggregate heavy modules:**

- Barrel or index files that re-export from multiple heavy modules defeat tree-shaking.
- Import directly from the source module path; never funnel unrelated heavy exports through a shared index file.

**Distinguish application code from framework overhead:**

- Before optimizing, verify whether JS chunks originate from application code or from the framework runtime (router, hydration bootstrap, chunk loader).
- Framework baseline cost is real but not actionable through code changes.
- Focus audits on first-party modules and their transitive dependencies.

**Reject immediately:**

- entire page marked as client-side when only a form or widget needs interactivity,
- rarely-used component statically imported in root layout or shell,
- outbound links on a lightweight page triggering eager prefetch of a heavy route,
- heavy third-party package imported in a shared module or barrel file,
- dismissing small leaks — they compound; the audit must be holistic.
