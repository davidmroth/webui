"""Accumulate engine timings payloads for cron + streamed webchat delivery.

The inference stack (engine → proxy) already emits llama.cpp-style ``timings``
on each API response. Non-streaming webchat turns attach the last call via
``event._hermes_timings``. Streaming turns finalize through ``edit_message`` and
Hermes suppresses the normal final send — so timings never reach WebUI unless
we buffer them here and attach on stream ``done``.

Cron deliveries also bypass ``_hermes_timings``; this module merges per-call
timings and attaches them when a ``Cronjob Response:`` wrapper is delivered.
"""

from __future__ import annotations

import logging
import os
import re
import sys
import threading
import time
from typing import Any, Callable, Mapping, MutableMapping, Optional

logger = logging.getLogger(__name__)

TimingsWaiter = Callable[[dict[str, Any]], None]

_CRON_WRAPPER_RE = re.compile(
    r"^Cronjob Response:\s*(?P<name>.+?)\s*\n"
    r"\(job_id:\s*(?P<job_id>[0-9a-f]+)\)\s*\n"
    r"-+\s*\n",
    re.IGNORECASE | re.MULTILINE,
)

# Process-wide singleton. Hermes may load this file under multiple module names
# (``timings_buffer``, ``webui_plugin_timings_buffer``, package-relative), and
# each import would otherwise get its own empty dicts — the post_api_request
# hook writes one copy while adapter.pop_chat_timings reads another.
_SHARED_STATE_ATTR = "_hermes_webui_timings_buffer_v1"


def _shared_state() -> dict[str, Any]:
    state = getattr(sys, _SHARED_STATE_ATTR, None)
    if not isinstance(state, dict) or "by_session" not in state:
        state = {
            "lock": threading.Lock(),
            "by_session": {},
            "latest_session_for_job": {},
            "session_for_chat": {},
            "session_updated_at": {},
            "pending_waiters": {},
        }
        setattr(sys, _SHARED_STATE_ATTR, state)
    # Older plugin loads may lack waiter map — extend in place.
    state.setdefault("pending_waiters", {})
    return state


_state = _shared_state()
_lock: threading.Lock = _state["lock"]
# session_id -> accumulated llamacpp-style timings dict
_by_session: dict[str, dict[str, Any]] = _state["by_session"]
# job_id -> most recently updated session_id (for delivery lookup)
_latest_session_for_job: dict[str, str] = _state["latest_session_for_job"]
# chat_id -> session_id (stream finalize lookup for webchat)
_session_for_chat: dict[str, str] = _state["session_for_chat"]
# session_id -> monotonic timestamp of last merge (for TTL eviction)
_session_updated_at: dict[str, float] = _state["session_updated_at"]
# chat_id -> waiters notified when timings are buffered (stream finalize race)
_pending_waiters: dict[str, list[TimingsWaiter]] = _state["pending_waiters"]

_BUFFER_TTL_SEC = 6 * 3600.0


def _resolve_session_chat_id() -> str:
    """Best-effort chat id for the in-flight gateway turn."""
    try:
        from gateway.session_context import get_session_env

        value = (get_session_env("HERMES_SESSION_CHAT_ID", "") or "").strip()
        if value:
            return value
    except Exception:
        pass
    return (os.getenv("HERMES_SESSION_CHAT_ID", "") or "").strip()


def parse_cron_delivery(content: str) -> Optional[dict[str, str]]:
    """Return ``{job_id, job_name}`` when *content* is a Hermes cron wrapper."""
    if not content or "Cronjob Response:" not in content:
        return None
    match = _CRON_WRAPPER_RE.search(content)
    if not match:
        return None
    return {
        "job_id": match.group("job_id").strip(),
        "job_name": match.group("name").strip(),
    }


def _to_mapping(value: Any) -> Optional[dict[str, Any]]:
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        try:
            dumped = model_dump(mode="python")
            if isinstance(dumped, dict):
                return dumped
        except TypeError:
            try:
                dumped = model_dump()
                if isinstance(dumped, dict):
                    return dumped
            except Exception:
                pass
        except Exception:
            pass
    extra = getattr(value, "model_extra", None)
    if extra is None:
        extra = getattr(value, "__pydantic_extra__", None)
    raw_dict = getattr(value, "__dict__", None)
    if isinstance(extra, dict) and extra:
        merged = dict(extra)
        if isinstance(raw_dict, dict):
            for key, item in raw_dict.items():
                if not str(key).startswith("_") and key not in merged:
                    merged[key] = item
        return merged
    if isinstance(raw_dict, dict):
        return dict(raw_dict)
    return None


def _first_number(source: Mapping[str, Any], keys: tuple[str, ...]) -> Optional[float]:
    for key in keys:
        raw = source.get(key)
        if raw is None:
            continue
        try:
            val = float(raw)
        except (TypeError, ValueError):
            continue
        if val >= 0:
            return val
    return None


def _first_int(source: Mapping[str, Any], keys: tuple[str, ...]) -> int:
    val = _first_number(source, keys)
    if val is None:
        return 0
    return int(val)


_FINGERPRINT_PREFIX = "hermes_timings:"


def decode_timings_fingerprint(raw: Any) -> Optional[dict[str, Any]]:
    """Parse proxy-stamped ``system_fingerprint`` timings backup."""
    if not isinstance(raw, str) or _FINGERPRINT_PREFIX not in raw:
        return None
    blob = raw[raw.find(_FINGERPRINT_PREFIX) + len(_FINGERPRINT_PREFIX) :]
    out: dict[str, Any] = {}
    for part in blob.split(","):
        if "=" not in part:
            continue
        key, _, value = part.partition("=")
        key = key.strip()
        if not key:
            continue
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            continue
        if key.endswith("_n") or key in {"cache_n", "prefix_len"}:
            out[key] = int(numeric)
        else:
            out[key] = numeric
    return out or None


def extract_timings_from_api_response(
    response: Any,
    *,
    usage: Optional[Mapping[str, Any]] = None,
    api_duration: Optional[float] = None,
) -> Optional[dict[str, Any]]:
    """Normalize one engine/proxy timings payload from a chat-completions response."""
    response_map = _to_mapping(response) or {}
    hook_usage = _to_mapping(usage) or {}
    response_usage = _to_mapping(response_map.get("usage")) or {}
    raw_usage = getattr(response, "usage", None) if response is not None else None
    if raw_usage is not None and not response_usage:
        response_usage = _to_mapping(raw_usage) or {}
    # Hermes hook usage is often token-only; prefer response-side usage/timings.
    usage_map = dict(hook_usage)
    usage_map.update(response_usage)
    usage_extra = getattr(raw_usage, "model_extra", None) if raw_usage is not None else None
    if not isinstance(usage_extra, dict):
        usage_extra = {}

    fingerprint = decode_timings_fingerprint(
        response_map.get("system_fingerprint")
        or getattr(response, "system_fingerprint", None)
        or usage_map.get("system_fingerprint")
        or usage_extra.get("system_fingerprint")
    )

    raw_timings: Optional[dict[str, Any]] = None
    for candidate in (
        response_map.get("timings"),
        usage_map.get("timings"),
        usage_extra.get("timings"),
        getattr(response, "timings", None) if response is not None else None,
        fingerprint,
    ):
        if isinstance(candidate, dict) and candidate:
            raw_timings = dict(candidate)
            break
        mapped = _to_mapping(candidate)
        if isinstance(mapped, dict) and mapped:
            raw_timings = dict(mapped)
            break

    prompt_n = _first_int(
        raw_timings or usage_map,
        ("prompt_n", "prompt_tokens", "prompt_eval_count", "input_tokens"),
    )
    predicted_n = _first_int(
        raw_timings or usage_map,
        ("predicted_n", "completion_tokens", "eval_count", "output_tokens"),
    )
    if raw_timings:
        if prompt_n == 0:
            prompt_n = _first_int(usage_map, ("prompt_tokens", "input_tokens"))
        if predicted_n == 0:
            predicted_n = _first_int(usage_map, ("completion_tokens", "output_tokens"))
    prompt_ms = _first_number(
        raw_timings or {},
        ("prompt_ms", "prefill_ms", "prompt_duration_ms", "prompt_eval_ms"),
    )
    predicted_ms = _first_number(
        raw_timings or {},
        ("predicted_ms", "decode_ms", "completion_ms", "eval_ms"),
    )
    ttft_ms = _first_number(
        raw_timings or {},
        ("ttft_ms", "ttfb_ms", "time_to_first_token_ms"),
    )
    cache_n = _first_int(
        raw_timings or usage_map,
        ("cache_n", "cache_tokens", "cached_prefix_tokens", "prefix_len"),
    )
    predicted_per_second = _first_number(
        raw_timings or {},
        ("predicted_per_second", "tokens_per_second", "decode_tokens_per_sec"),
    )
    prompt_per_second = _first_number(
        raw_timings or {},
        ("prompt_per_second",),
    )

    if prompt_n == 0 and predicted_n == 0 and not raw_timings:
        prompt_n = _first_int(usage_map, ("prompt_tokens", "input_tokens"))
        predicted_n = _first_int(usage_map, ("completion_tokens", "output_tokens"))

    if prompt_ms is None and api_duration and (prompt_n or predicted_n):
        total_ms = max(float(api_duration) * 1000.0, 1.0)
        token_total = max(prompt_n + predicted_n, 1)
        if prompt_n and predicted_n:
            prompt_ms = max(total_ms * (prompt_n / token_total), 0.001)
            # Never overwrite a real decode duration from the engine.
            if predicted_ms is None:
                predicted_ms = max(total_ms - prompt_ms, 0.001)
        elif predicted_n and predicted_ms is None:
            predicted_ms = total_ms
        elif prompt_n:
            prompt_ms = total_ms
    elif predicted_ms is None and predicted_n and predicted_per_second and predicted_per_second > 0:
        predicted_ms = (predicted_n / predicted_per_second) * 1000.0
    elif prompt_ms is None and prompt_n and prompt_per_second and prompt_per_second > 0:
        prompt_ms = (prompt_n / prompt_per_second) * 1000.0

    if prompt_n == 0 and predicted_n == 0 and prompt_ms is None and predicted_ms is None:
        return None

    # Failed / empty completions often arrive with wire TTFT as prompt_ms
    # (sub-ms) and predicted_n=0 — that yields absurd million-t/s rates and
    # poisons the stream-finalize stats card. Drop those calls entirely.
    if predicted_n <= 0:
        return None
    if (
        prompt_ms is not None
        and prompt_n >= 100
        and prompt_ms < 50.0
    ):
        # <50ms for ≥100 tokens is not real prefill (cold or warm).
        prompt_ms = None

    out: dict[str, Any] = {
        "prompt_n": prompt_n,
        "predicted_n": predicted_n,
    }
    if cache_n > 0:
        out["cache_n"] = cache_n
    if prompt_ms is not None:
        out["prompt_ms"] = round(prompt_ms, 3)
    if predicted_ms is not None:
        out["predicted_ms"] = round(predicted_ms, 3)
    if ttft_ms is not None:
        out["ttft_ms"] = round(ttft_ms, 3)
    if prompt_ms and prompt_n > 0:
        seconds = prompt_ms / 1000.0
        out["effective_prompt_per_second"] = round(prompt_n / seconds, 3)
        uncached = max(prompt_n - cache_n, 0)
        actual = round(uncached / seconds, 3) if uncached > 0 else 0.0
        out["prompt_per_second"] = actual
        out["actual_prompt_per_second"] = actual
    elif prompt_per_second is not None:
        out["prompt_per_second"] = round(prompt_per_second, 3)
    if predicted_per_second is not None:
        out["predicted_per_second"] = round(predicted_per_second, 3)
    elif predicted_ms and predicted_n > 0:
        out["predicted_per_second"] = round(predicted_n / (predicted_ms / 1000.0), 3)

    return out


def _merge_timings(existing: dict[str, Any], new: Mapping[str, Any]) -> dict[str, Any]:
    merged = dict(existing)
    merged["prompt_n"] = int(merged.get("prompt_n") or 0) + int(new.get("prompt_n") or 0)
    merged["predicted_n"] = int(merged.get("predicted_n") or 0) + int(new.get("predicted_n") or 0)
    merged["cache_n"] = int(merged.get("cache_n") or 0) + int(new.get("cache_n") or 0)
    merged["prompt_ms"] = round(float(merged.get("prompt_ms") or 0) + float(new.get("prompt_ms") or 0), 3)
    merged["predicted_ms"] = round(float(merged.get("predicted_ms") or 0) + float(new.get("predicted_ms") or 0), 3)
    merged["api_calls"] = int(merged.get("api_calls") or 0) + 1

    wall_ms = float(merged.get("wall_ms") or 0) + float(new.get("_wall_ms") or 0)
    if wall_ms > 0:
        merged["wall_ms"] = round(wall_ms, 3)

    if "ttft_ms" not in merged and new.get("ttft_ms") is not None:
        merged["ttft_ms"] = new["ttft_ms"]

    prompt_n = int(merged.get("prompt_n") or 0)
    predicted_n = int(merged.get("predicted_n") or 0)
    cache_n = int(merged.get("cache_n") or 0)
    prompt_ms = float(merged.get("prompt_ms") or 0)
    predicted_ms = float(merged.get("predicted_ms") or 0)

    if prompt_ms > 0 and prompt_n > 0:
        seconds = prompt_ms / 1000.0
        merged["effective_prompt_per_second"] = round(prompt_n / seconds, 3)
        uncached = max(prompt_n - cache_n, 0)
        actual = round(uncached / seconds, 3) if uncached > 0 else 0.0
        merged["prompt_per_second"] = actual
        merged["actual_prompt_per_second"] = actual
    if predicted_ms > 0 and predicted_n > 0:
        merged["predicted_per_second"] = round(predicted_n / (predicted_ms / 1000.0), 3)

    api_calls = int(merged.get("api_calls") or 0)
    merged["agentic"] = {
        "llm": {
            "api_calls": api_calls,
            "prompt_n": prompt_n,
            "predicted_n": predicted_n,
            "prompt_ms": merged.get("prompt_ms"),
            "predicted_ms": merged.get("predicted_ms"),
            "wall_ms": merged.get("wall_ms"),
        }
    }
    return merged


def job_id_from_session(session_id: str) -> Optional[str]:
    """Return cron job id embedded in a cron session key."""
    parts = (session_id or "").split("_")
    if len(parts) >= 3 and parts[0] == "cron":
        return parts[1]
    return None


def _extract_job_id(session_id: str) -> Optional[str]:
    return job_id_from_session(session_id)


def _evict_stale(now: float) -> None:
    stale = [
        sid
        for sid, updated in _session_updated_at.items()
        if now - updated > _BUFFER_TTL_SEC
    ]
    for sid in stale:
        _by_session.pop(sid, None)
        _session_updated_at.pop(sid, None)
    stale_jobs = [
        job_id
        for job_id, sid in _latest_session_for_job.items()
        if sid not in _by_session
    ]
    for job_id in stale_jobs:
        _latest_session_for_job.pop(job_id, None)
    # Only drop chat bindings for sessions we actually TTL-evicted. A bind that
    # arrives before the first API timing record must survive until pop.
    if stale:
        stale_set = set(stale)
        stale_chats = [
            chat_id
            for chat_id, sid in _session_for_chat.items()
            if sid in stale_set
        ]
        for chat_id in stale_chats:
            _session_for_chat.pop(chat_id, None)


def _should_buffer_platform(platform: str, session_id: str) -> bool:
    normalized = (platform or "").strip().lower()
    if normalized in {"cron", "webchat"}:
        return True
    return session_id.startswith("cron_")


def record_api_timings(
    *,
    session_id: str,
    platform: str,
    response: Any = None,
    usage: Optional[Mapping[str, Any]] = None,
    api_duration: Optional[float] = None,
) -> None:
    """Merge one API call's timings into the session accumulator."""
    sid = (session_id or "").strip()
    if not sid:
        return
    if not _should_buffer_platform(platform, sid):
        return

    timings = extract_timings_from_api_response(
        response,
        usage=usage,
        api_duration=api_duration,
    )
    if not timings:
        return

    if api_duration is not None and api_duration > 0:
        timings = dict(timings)
        timings["_wall_ms"] = round(float(api_duration) * 1000.0, 3)

    chat_id = _resolve_session_chat_id()
    now = time.monotonic()
    waiters: list[TimingsWaiter] = []
    waiter_payload: Optional[dict[str, Any]] = None
    with _lock:
        _evict_stale(now)
        current = _by_session.get(sid, {})
        merged = _merge_timings(current, timings)
        merged.pop("_wall_ms", None)
        _by_session[sid] = merged
        _session_updated_at[sid] = now
        job_id = _extract_job_id(sid)
        if job_id:
            _latest_session_for_job[job_id] = sid
        if chat_id:
            _session_for_chat[chat_id] = sid
        notify_chats = {
            cid for cid, mapped in _session_for_chat.items() if mapped == sid
        }
        if chat_id:
            notify_chats.add(chat_id)
        for cid in notify_chats:
            waiters.extend(_pending_waiters.pop(cid, []))
        # Delivering to waiters consumes the buffer so the next turn cannot
        # accidentally attach this turn's timings.
        if waiters:
            waiter_payload = _pop_session_timings_locked(sid, chat_id)

    logger.debug(
        "Buffered timings platform=%s session=%s chat=%s calls=%s prompt_n=%s predicted_n=%s",
        platform or "?",
        sid,
        chat_id or "-",
        merged.get("api_calls"),
        merged.get("prompt_n"),
        merged.get("predicted_n"),
    )

    if waiters and waiter_payload:
        for waiter in waiters:
            try:
                waiter(waiter_payload)
            except Exception as exc:
                logger.debug("timings waiter failed: %s", exc)


def bind_chat_session(chat_id: str, session_id: Optional[str] = None) -> None:
    """Associate *chat_id* with a buffered session for stream-finalize lookup."""
    cid = (chat_id or "").strip()
    if not cid:
        return
    sid = (session_id or "").strip()
    if not sid:
        try:
            from gateway.session_context import get_session_env

            sid = (get_session_env("HERMES_SESSION_ID", "") or "").strip()
        except Exception:
            sid = ""
        if not sid:
            sid = (os.getenv("HERMES_SESSION_ID", "") or "").strip()
    if not sid:
        return
    with _lock:
        _session_for_chat[cid] = sid


def pop_delivery_timings(job_id: str) -> Optional[dict[str, Any]]:
    """Return aggregated timings for *job_id* and clear the buffer."""
    jid = (job_id or "").strip()
    if not jid:
        return None
    with _lock:
        sid = _latest_session_for_job.get(jid)
        if not sid:
            return None
        timings = _by_session.pop(sid, None)
        _session_updated_at.pop(sid, None)
        _latest_session_for_job.pop(jid, None)
        for chat_id, mapped in list(_session_for_chat.items()):
            if mapped == sid:
                _session_for_chat.pop(chat_id, None)
    if not timings:
        return None
    cleaned = dict(timings)
    cleaned.pop("_wall_ms", None)
    return cleaned


def _resolve_chat_session_id_locked(cid: str) -> str:
    sid = _session_for_chat.get(cid) or ""
    if sid:
        return sid
    # Fallback when ContextVar chat binding was unavailable during the
    # API hook: use the only non-cron buffered session, if unique.
    candidates = [
        session_id
        for session_id in _by_session
        if not session_id.startswith("cron_")
    ]
    if len(candidates) == 1:
        sid = candidates[0]
        _session_for_chat[cid] = sid
        return sid
    return ""


def _pop_session_timings_locked(sid: str, cid: str) -> Optional[dict[str, Any]]:
    timings = _by_session.get(sid)
    if not timings:
        return None
    _by_session.pop(sid, None)
    _session_updated_at.pop(sid, None)
    _session_for_chat.pop(cid, None)
    for job_id, mapped in list(_latest_session_for_job.items()):
        if mapped == sid:
            _latest_session_for_job.pop(job_id, None)
    for mapped_chat, mapped_sid in list(_session_for_chat.items()):
        if mapped_sid == sid:
            _session_for_chat.pop(mapped_chat, None)
    cleaned = dict(timings)
    cleaned.pop("_wall_ms", None)
    return cleaned


def pop_chat_timings(chat_id: str) -> Optional[dict[str, Any]]:
    """Return aggregated timings for a webchat conversation and clear them.

    If the chat is bound but timings are not buffered yet (stream finalize
    races ahead of ``post_api_request``), leave the chat→session binding so a
    later retry can still find the payload.
    """
    cid = (chat_id or "").strip()
    if not cid:
        return None
    with _lock:
        sid = _resolve_chat_session_id_locked(cid)
        if not sid:
            return None
        return _pop_session_timings_locked(sid, cid)


def subscribe_chat_timings(
    chat_id: str, callback: TimingsWaiter
) -> Optional[dict[str, Any]]:
    """Return buffered timings immediately, or register *callback* for the next buffer.

    Used when stream finalize races ahead of ``post_api_request``: the waiter
    fires as soon as timings land instead of polling for a few seconds.
    """
    cid = (chat_id or "").strip()
    if not cid:
        return None
    with _lock:
        sid = _resolve_chat_session_id_locked(cid)
        if sid:
            ready = _pop_session_timings_locked(sid, cid)
            if ready:
                return ready
        _pending_waiters.setdefault(cid, []).append(callback)
    return None


def unsubscribe_chat_timings(chat_id: str, callback: TimingsWaiter) -> None:
    """Remove a previously registered timings waiter."""
    cid = (chat_id or "").strip()
    if not cid:
        return
    with _lock:
        waiters = _pending_waiters.get(cid)
        if not waiters:
            return
        try:
            waiters.remove(callback)
        except ValueError:
            return
        if not waiters:
            _pending_waiters.pop(cid, None)


def on_post_api_request(**kwargs: Any) -> None:
    """Hermes plugin hook entrypoint."""
    try:
        record_api_timings(
            session_id=str(kwargs.get("session_id") or ""),
            platform=str(kwargs.get("platform") or ""),
            response=kwargs.get("response"),
            usage=kwargs.get("usage") if isinstance(kwargs.get("usage"), dict) else None,
            api_duration=kwargs.get("api_duration"),
        )
    except Exception as exc:
        logger.debug("post_api_request timings buffer failed: %s", exc)


def enrich_send_metadata(content: str, metadata: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Attach buffered cron timings when delivering a cron wrapper to WebUI."""
    out: dict[str, Any] = dict(metadata or {})
    if out.get("timings"):
        return out or None

    cron = parse_cron_delivery(content)
    if not cron:
        return out or None

    timings = pop_delivery_timings(cron["job_id"])
    if timings:
        out["timings"] = timings
    out.setdefault("cron_delivery", cron)
    return out
