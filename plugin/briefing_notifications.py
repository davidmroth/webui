"""Notify WebUI when Hermes creates a briefing job."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable

import httpx

logger = logging.getLogger(__name__)

_BRIEFING_TOOLS = {"create_briefing", "regenerate_briefing"}


def _optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _conversation_id() -> str | None:
    try:
        from gateway.session_context import get_session_env

        platform = (get_session_env("HERMES_SESSION_PLATFORM", "") or "").strip().lower()
        if platform == "webchat":
            current_chat_id = _optional_string(
                get_session_env("HERMES_SESSION_CHAT_ID", "")
            )
            if current_chat_id:
                return current_chat_id
    except Exception:
        logger.debug("Unable to resolve the active Hermes session", exc_info=True)

    return _optional_string(os.getenv("WEBCHAT_HOME_CHANNEL"))


def _briefing_state(status: Any) -> str:
    normalized = _optional_string(status)
    if normalized in {"completed", "ready"}:
        return "ready"
    if normalized in {"failed", "error"}:
        return "failed"
    return "processing"


def _notification_payload(args: dict, result: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(result)
    except (TypeError, json.JSONDecodeError):
        return None

    if not isinstance(parsed, dict) or parsed.get("success") is not True:
        return None

    job_id = _optional_string(parsed.get("job_id"))
    if not job_id:
        nested_result = parsed.get("result")
        if isinstance(nested_result, dict):
            job_id = _optional_string(nested_result.get("job_id"))
    if not job_id:
        return None

    payload: dict[str, Any] = {
        "jobId": job_id,
        "state": _briefing_state(parsed.get("status")),
    }
    conversation_id = _conversation_id()
    if conversation_id:
        payload["conversationId"] = conversation_id

    title = (
        _optional_string(args.get("title"))
        or _optional_string(parsed.get("title"))
        or _optional_string(args.get("topic"))
    )
    summary = _optional_string(args.get("summary")) or _optional_string(
        parsed.get("summary")
    )
    if title:
        payload["title"] = title
    if summary:
        payload["summary"] = summary
    return payload


def on_post_tool_call(
    tool_name: str,
    args: dict,
    result: str,
    *,
    client_factory: Callable[..., Any] = httpx.Client,
    **_kwargs: Any,
) -> None:
    """Push successful briefing tool results into the WebUI catalog."""
    if tool_name not in _BRIEFING_TOOLS:
        return

    payload = _notification_payload(args, result)
    if not payload:
        return

    base_url = _optional_string(os.getenv("WEBCHAT_URL"))
    token = _optional_string(os.getenv("WEBCHAT_SERVICE_TOKEN"))
    if not base_url or not token:
        logger.debug("Skipping briefing notification because WebUI is not configured")
        return

    try:
        with client_factory(timeout=10.0) as client:
            response = client.post(
                f"{base_url.rstrip('/')}/api/internal/hermes/briefings",
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {token}",
                },
                json=payload,
            )
            response.raise_for_status()
    except Exception as exc:
        logger.warning(
            "Unable to notify WebUI about briefing job %s: %s",
            payload["jobId"],
            exc,
        )
