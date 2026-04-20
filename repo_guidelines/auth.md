# Authentication & RBAC

Authentication and role-based access control standards. Covers JWT lifecycle, session expiration handling, role-to-permission mapping, backend-only enforcement, admin seeding, and password hashing.

For the architectural principles that motivate these rules, see [architecture.md](./architecture.md).

---

## Guiding Principle

Authentication must be a first-class domain, not a bolted-on middleware or afterthought. Auth is a domain like any other — it has models, a service, and a repository.

---

## Domain Structure

```text
backend/src/app/
  domain/
    auth/
      models/        # identity models, role definitions, permission mappings
      service/       # token lifecycle, role resolution, auth operations
      permissions/   # permission sets, role→permission mappings
  api/
    dependencies/    # route-level guards that enforce roles and permissions
```

---

## JWT Lifecycle

- Use **short-lived access tokens** and **long-lived refresh tokens**.
- Refresh tokens must be stored server-side and revocable.
- Tokens are issued, validated, and revoked exclusively by the backend.

---

## Role → Permission Mapping

- Roles map to permission sets.
- Permission checks happen at the **route or service boundary** via explicit guards or dependencies, not scattered conditionals inside business logic.
- The role-to-permission mapping must be **extensible without code changes** to the guard logic. Adding a new role means adding a mapping entry, not editing every protected route.
- Auth-related classification (role resolution, token validation outcomes) follows the same classify-once rules as all other domain classification — see [Classify Once](./architecture.md#classify-once-consume-structured-metadata).

---

## Backend-Only Enforcement

- The **backend is the sole authority** for identity, roles, and permissions.
- Frontend code may read the current user's role and permissions from backend-issued structured metadata to control UI visibility, but **client-side checks must never serve as a security boundary**.
- The backend must enforce every access rule independently.

---

## Admin Seeding

- Admin user seeding must be part of the **application bootstrap lifecycle**, driven by configuration.
- Never rely on manual database inserts to create admin users.

---

## Password Hashing

- Password hashing must use a **dedicated, isolated service or utility**.
- Never store or compare plaintext passwords.

---

## Session Lifecycle — Proactive Expiration Handling

Users must never be abruptly redirected to a login page when a token expires. The frontend must manage two complementary behaviors:

1. **Automatic session extension** — while the user is actively interacting, tokens are silently refreshed so the session never expires during use.
2. **Inactivity warning** — when the user has been idle and the token is about to expire, a countdown modal gives them a chance to stay logged in or log out gracefully.

### Activity Tracking

- Track user activity via DOM events (`mousedown`, `keydown`, `scroll`, `touchstart`).
- Throttle the listener to avoid performance impact (one update per N seconds is sufficient).
- Maintain a `lastActivityTimestamp` in the session monitor's state.

### Proactive Token Refresh

- Decode the JWT `exp` claim to determine token lifetime.
- Schedule a refresh at a **midpoint threshold** (e.g., 50% of token lifetime).
- At the threshold:
  - If the user has been **active** since the token was issued → silently refresh the token and reset the cycle.
  - If the user has been **idle** → skip the refresh and enter the warning phase.

### Inactivity Warning Phase

- Fire a warning state a configurable interval **before expiration** (e.g., 2 minutes).
- Expose structured session status to the UI — not free-form text:
  - `status`: `'active' | 'warning' | 'expired'`
  - `secondsRemaining`: number
- Provide two actions:
  - **Extend session** — refreshes the token and resets the cycle.
  - **Log out** — clears tokens and navigates to login.
- The warning modal must follow the application's existing modal design language (overlay, confirm/cancel buttons, themed icons — no emoji, no native browser dialogs).
- The modal must only appear during inactivity. Active users must never see it.

### Session Monitor Hook

The session lifecycle belongs in a dedicated hook within the auth domain (e.g., `domains/auth/hooks/useSessionMonitor`):

- Owns activity listeners, refresh scheduling, and warning countdown.
- Exposes structured status and actions (`extendSession`, `handleExpired`).
- Integrated by the auth provider, which renders the warning modal when `status === 'warning'`.

### API Client — Event-Driven Expiration

- The API client (e.g., an Axios or fetch wrapper in `shared/lib/`) must not perform hard redirects on auth failure.
- On unrecoverable 401 (refresh token also expired or revoked), the client must dispatch a structured event (e.g., `CustomEvent('session:expired')`) instead of navigating directly.
- The session monitor listens for this event as a fallback and triggers the appropriate UI flow (warning modal or cleanup and redirect).

### Domain Structure

```text
frontend/src/
  domains/
    auth/
      hooks/
        useSessionMonitor  # activity tracking, refresh scheduling, warning state
  shared/
    components/
      SessionExpirationModal/  # warning countdown UI
    lib/
      apiClient              # dispatches session:expired event on unrecoverable 401
```

### Reject Immediately

- Hard-redirecting to `/login` on token expiration without warning.
- API clients performing `window.location.href = '/login'` instead of dispatching a structured event.
- Refresh logic that runs unconditionally regardless of user activity.
- Warning modals that use native browser dialogs (`alert`, `confirm`).
- Session status communicated as free-form strings parsed by the UI instead of structured typed state.
- Activity tracking logic scattered across components instead of centralized in the session monitor.

---

## Reject Immediately

- Role or permission checks implemented by parsing token strings or user-facing text.
- Security logic duplicated across frontend and backend instead of backend-only enforcement.
- Hardcoded user IDs, emails, or role names used as control flow outside of bootstrap seeding.
- Ad hoc permission checks scattered inside business logic instead of at service or route boundaries.
- Frontend deciding access by parsing backend messages instead of reading structured metadata.
