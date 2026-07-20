"""Webchat platform adapter.

This adapter integrates Hermes with the sibling browser web UI service.
It polls the web UI for queued inbound browser messages and posts assistant
messages back to the web UI over authenticated HTTP.
"""

from __future__ import annotations

import asyncio
import base64
import dataclasses
import hashlib
import json
import logging
import mimetypes
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional
from uuid import uuid4

try:
    import httpx

    HTTPX_AVAILABLE = True
except ImportError:
    httpx = None  # type: ignore[assignment]
    HTTPX_AVAILABLE = False

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import (
    BasePlatformAdapter,
    MessageEvent,
    MessageType,
    ProcessingOutcome,
    SendResult,
    cache_audio_from_bytes,
    cache_document_from_bytes,
    cache_image_from_bytes,
)
from gateway.session import build_session_key

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "http://127.0.0.1:3000"
DEFAULT_POLL_INTERVAL = 1.0
DEFAULT_TIMEOUT_SECONDS = 30.0
DEFAULT_COMMAND_SYNC_RETRIES = 4
DEFAULT_COMMAND_SYNC_BACKOFF_SECONDS = 1.0
DEFAULT_COMMAND_SYNC_MAX_BACKOFF_SECONDS = 8.0
DEFAULT_RECONNECT_BACKOFF_SECONDS = 1.0
DEFAULT_RECONNECT_MAX_BACKOFF_SECONDS = 30.0


def check_webchat_requirements() -> bool:
    """Return True when the webchat adapter dependencies are available."""
    return HTTPX_AVAILABLE


def _normalize_webchat_context_url(base_url: str, context_url: Any) -> Optional[str]:
    raw = str(context_url or "").strip()
    if not raw:
        return None
    if raw.startswith(("http://", "https://")):
        return raw
    if raw.startswith("/"):
        return f"{base_url}{raw}"
    return f"{base_url}/{raw}"


def _normalize_webchat_context_marker(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    conversation_id = str(raw.get("conversationId") or "").strip()
    if not conversation_id:
        return None

    curr_node = raw.get("currNode")
    if curr_node is not None:
        curr_node = str(curr_node).strip() or None

    try:
        last_modified = int(raw.get("lastModified") or 0)
    except (TypeError, ValueError):
        last_modified = 0

    raw_visible_ids = raw.get("visibleMessageIds")
    visible_message_ids = (
        [
            str(message_id).strip()
            for message_id in raw_visible_ids
            if str(message_id).strip()
        ]
        if isinstance(raw_visible_ids, list)
        else []
    )

    try:
        schema_version = int(raw.get("schemaVersion") or 0)
    except (TypeError, ValueError):
        schema_version = 0

    public_base_url = str(raw.get("publicBaseUrl") or "").strip() or None

    marker = {
        "schemaVersion": schema_version,
        "conversationId": conversation_id,
        "currNode": curr_node,
        "lastModified": last_modified,
        "visibleMessageIds": visible_message_ids,
    }
    if public_base_url:
        marker["publicBaseUrl"] = public_base_url
    return marker


def build_webchat_context_marker(context_payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    conversation = context_payload.get("conversation")
    if not isinstance(conversation, dict):
        return None

    return _normalize_webchat_context_marker(
        {
            "schemaVersion": context_payload.get("schemaVersion"),
            "publicBaseUrl": context_payload.get("publicBaseUrl"),
            "conversationId": conversation.get("id"),
            "currNode": conversation.get("currNode"),
            "lastModified": conversation.get("lastModified"),
            "visibleMessageIds": context_payload.get("visibleMessageIds"),
        }
    )


def _format_webchat_attachment_note(raw_attachments: Any) -> str:
    if not isinstance(raw_attachments, list) or not raw_attachments:
        return ""

    summarized: list[str] = []
    for raw_attachment in raw_attachments[:5]:
        if not isinstance(raw_attachment, dict):
            continue
        file_name = str(raw_attachment.get("fileName") or "attachment").strip() or "attachment"
        content_type = (
            str(raw_attachment.get("contentType") or "application/octet-stream").strip()
            or "application/octet-stream"
        )
        size_label = ""
        try:
            size_bytes = int(raw_attachment.get("sizeBytes") or 0)
            if size_bytes > 0:
                size_label = f", {size_bytes} bytes"
        except (TypeError, ValueError):
            size_label = ""
        summarized.append(f"{file_name} ({content_type}{size_label})")

    if not summarized:
        return "[Attachments]"

    remaining = max(0, len(raw_attachments) - len(summarized))
    if remaining > 0:
        summarized.append(f"+{remaining} more")

    return f"[Attachments: {', '.join(summarized)}]"


def export_lacks_tool_round_trip(context_payload: Dict[str, Any]) -> bool:
    """True when the WebUI export has no structured tool calls or tool results."""
    raw_messages = context_payload.get("messages")
    if not isinstance(raw_messages, list):
        return True

    for raw_message in raw_messages:
        if not isinstance(raw_message, dict):
            continue
        if str(raw_message.get("role") or "").strip().lower() == "tool":
            return False
        tool_calls = raw_message.get("toolCalls")
        if tool_calls:
            return False
    return True


def transcript_has_tool_round_trip(messages: list) -> bool:
    """True when a persisted gateway transcript still has OpenAI-style tool rows."""
    for message in messages:
        if not isinstance(message, dict):
            continue
        if message.get("role") == "tool":
            return True
        if message.get("tool_calls"):
            return True
    return False


def _is_tool_progress_message(raw_message: Dict[str, Any]) -> bool:
    """True for cosmetic tool-activity breadcrumbs (displayType == "tool_progress").

    The web UI stores a UI-only ``system`` message for every tool round (e.g.
    ``🐍 execute_code: "import subprocess..."``). These are truncated previews of
    the tool *input* — they carry no real conversational content and no structured
    ``toolCalls``/results survive the round trip.
    """
    extra = raw_message.get("extra")
    if isinstance(extra, dict) and str(extra.get("displayType") or "").strip() == "tool_progress":
        return True
    # Top-level displayType (older/export-normalized shape) is honored too.
    return str(raw_message.get("displayType") or "").strip() == "tool_progress"


def _is_interim_assistant_before_tool_progress(
    raw_message: Optional[Dict[str, Any]],
    next_raw_message: Optional[Dict[str, Any]],
) -> bool:
    """Assistant line that only announces the next tool_progress breadcrumb."""
    if not isinstance(raw_message, dict):
        return False
    if str(raw_message.get("role") or "").strip().lower() != "assistant":
        return False
    return isinstance(next_raw_message, dict) and _is_tool_progress_message(next_raw_message)


def _normalize_export_tool_calls(raw_tool_calls: Any) -> Optional[list[Dict[str, Any]]]:
    if not isinstance(raw_tool_calls, list) or not raw_tool_calls:
        return None

    normalized: list[Dict[str, Any]] = []
    for raw_call in raw_tool_calls:
        if not isinstance(raw_call, dict):
            continue
        call_id = str(raw_call.get("id") or "").strip()
        function = raw_call.get("function")
        if isinstance(function, dict):
            name = str(function.get("name") or "").strip()
            arguments = function.get("arguments")
        else:
            name = str(raw_call.get("name") or "").strip()
            arguments = raw_call.get("arguments")
        if not call_id or not name:
            continue
        if arguments is None:
            arguments = "{}"
        elif not isinstance(arguments, str):
            arguments = json.dumps(arguments, separators=(",", ":"), ensure_ascii=False)
        normalized.append(
            {
                "id": call_id,
                "type": "function",
                "function": {"name": name, "arguments": arguments},
            }
        )

    return normalized or None


def _tool_result_content(raw_content: Any) -> str:
    if isinstance(raw_content, str):
        return raw_content
    if raw_content is None:
        return ""
    try:
        return json.dumps(raw_content, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(raw_content)


def _build_webchat_context_message(raw_message: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw_message, dict):
        return None

    role = str(raw_message.get("role") or "").strip().lower()
    if role == "tool":
        tool_call_id = str(
            raw_message.get("toolCallId") or raw_message.get("tool_call_id") or ""
        ).strip()
        content = _tool_result_content(raw_message.get("content"))
        if not tool_call_id or not content.strip():
            return None
        entry: Dict[str, Any] = {
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": content,
        }
        timestamp = str(raw_message.get("createdAt") or "").strip()
        if timestamp:
            entry["timestamp"] = timestamp
        return entry

    if role not in {"user", "assistant", "system"}:
        return None

    # Skip cosmetic tool-progress breadcrumbs. Replaying them as assistant turns
    # is what breaks long webchat sessions: the web UI flattens every tool round
    # into a ``system`` message, this builder mapped them to the ``assistant``
    # role, and with no structured tool calls surviving the model ends up looking
    # at a long assistant monologue where "using a tool" appears as plain prose.
    # In-context imitation then biases it to narrate its next step instead of
    # emitting a real tool call, so the agent loop ends the turn early and the
    # task stalls. Excluding these breadcrumbs restores clean user/assistant
    # structure without losing real content (the assistant's own replies already
    # summarize tool outcomes).
    if _is_tool_progress_message(raw_message):
        return None

    mapped_role = "assistant" if role == "system" else role
    content = str(raw_message.get("content") or "")
    attachment_note = _format_webchat_attachment_note(raw_message.get("attachments"))

    parts: list[str] = []
    if role == "system":
        normalized = content.strip()
        if normalized:
            parts.append(f"[System status] {normalized}")
    elif content:
        parts.append(content)

    if attachment_note:
        parts.append(attachment_note)

    final_content = "\n\n".join(part for part in parts if part).strip()
    tool_calls = _normalize_export_tool_calls(raw_message.get("toolCalls"))
    if not final_content and not tool_calls:
        return None

    entry: Dict[str, Any] = {
        "role": mapped_role,
        "content": final_content,
    }

    timestamp = str(raw_message.get("createdAt") or "").strip()
    if timestamp:
        entry["timestamp"] = timestamp

    reasoning = raw_message.get("reasoningContent")
    if mapped_role == "assistant" and isinstance(reasoning, str) and reasoning.strip():
        entry["reasoning"] = reasoning.strip()

    if mapped_role == "assistant" and tool_calls:
        entry["tool_calls"] = tool_calls

    return entry


def _serialize_command_catalog(commands: list[Dict[str, Any]]) -> str:
    normalized: list[Dict[str, Any]] = []
    for entry in commands:
        normalized_entry: Dict[str, Any] = {
            "command": str(entry.get("command") or "").strip(),
            "description": str(entry.get("description") or "Hermes command").strip() or "Hermes command",
        }
        args_hint = str(entry.get("argsHint") or "").strip()
        category = str(entry.get("category") or "").strip()
        aliases = entry.get("aliases")
        requires_confirmation = entry.get("requiresConfirmation") is True

        if args_hint:
            normalized_entry["argsHint"] = args_hint
        if category:
            normalized_entry["category"] = category
        if isinstance(aliases, list):
            normalized_aliases = [
                str(alias).strip() for alias in aliases if str(alias).strip()
            ]
            if normalized_aliases:
                normalized_entry["aliases"] = normalized_aliases
        if requires_confirmation:
            normalized_entry["requiresConfirmation"] = True

        normalized.append(normalized_entry)

    return json.dumps(normalized, separators=(",", ":"), ensure_ascii=False)


def _command_catalog_hash(commands: list[Dict[str, Any]]) -> str:
    return hashlib.sha256(_serialize_command_catalog(commands).encode("utf-8")).hexdigest()


def build_webchat_context_transcript(
    context_payload: Dict[str, Any],
    *,
    exclude_message_id: Optional[str] = None,
) -> list[Dict[str, Any]]:
    marker = build_webchat_context_marker(context_payload)
    if marker is None:
        return []

    raw_messages = context_payload.get("messages")
    messages_by_id: Dict[str, Dict[str, Any]] = {}
    if isinstance(raw_messages, list):
        for raw_message in raw_messages:
            if not isinstance(raw_message, dict):
                continue
            message_id = str(raw_message.get("id") or "").strip()
            if not message_id:
                continue
            messages_by_id[message_id] = raw_message

    transcript_timestamp = str(
        context_payload.get("exportedAt")
        or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    )
    transcript: list[Dict[str, Any]] = [
        {
            "role": "session_meta",
            "webchat_context": marker,
            "timestamp": transcript_timestamp,
        }
    ]

    excluded_id = str(exclude_message_id or "").strip()
    visible_ids = marker["visibleMessageIds"]
    for index, message_id in enumerate(visible_ids):
        if excluded_id and message_id == excluded_id:
            continue
        raw_message = messages_by_id.get(message_id)
        next_raw_message = (
            messages_by_id.get(visible_ids[index + 1])
            if index + 1 < len(visible_ids)
            else None
        )
        if _is_interim_assistant_before_tool_progress(raw_message, next_raw_message):
            continue
        entry = _build_webchat_context_message(raw_message)
        if entry:
            transcript.append(entry)

    return transcript


class WebChatAdapter(BasePlatformAdapter):
    """Browser-chat adapter backed by the web UI service."""

    SUPPORTS_MESSAGE_EDITING = True
    MAX_MESSAGE_LENGTH = 65536

    def __init__(self, config: PlatformConfig):
        super().__init__(config, Platform("webchat"))
        extra = config.extra or {}
        self._base_url = (
            extra.get("url") or os.getenv("WEBCHAT_URL", DEFAULT_BASE_URL)
        ).rstrip("/")
        self._public_base_url = (
            extra.get("public_base_url")
            or os.getenv("WEBCHAT_PUBLIC_BASE_URL", self._base_url)
        ).rstrip("/")
        self._service_token = (
            config.token
            or extra.get("service_token")
            or os.getenv("WEBCHAT_SERVICE_TOKEN", "")
        )
        self._poll_interval = float(
            extra.get("poll_interval")
            or os.getenv("WEBCHAT_POLL_INTERVAL", str(DEFAULT_POLL_INTERVAL))
        )
        self._timeout_seconds = float(
            extra.get("timeout_seconds")
            or os.getenv("WEBCHAT_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS))
        )
        self._command_sync_retries = int(
            extra.get("command_sync_retries")
            or os.getenv("WEBCHAT_COMMAND_SYNC_RETRIES", str(DEFAULT_COMMAND_SYNC_RETRIES))
        )
        self._command_sync_backoff_seconds = float(
            extra.get("command_sync_backoff_seconds")
            or os.getenv(
                "WEBCHAT_COMMAND_SYNC_BACKOFF_SECONDS",
                str(DEFAULT_COMMAND_SYNC_BACKOFF_SECONDS),
            )
        )
        self._command_sync_max_backoff_seconds = float(
            extra.get("command_sync_max_backoff_seconds")
            or os.getenv(
                "WEBCHAT_COMMAND_SYNC_MAX_BACKOFF_SECONDS",
                str(DEFAULT_COMMAND_SYNC_MAX_BACKOFF_SECONDS),
            )
        )
        self._reconnect_backoff_seconds = float(
            extra.get("reconnect_backoff_seconds")
            or os.getenv(
                "WEBCHAT_RECONNECT_BACKOFF_SECONDS",
                str(DEFAULT_RECONNECT_BACKOFF_SECONDS),
            )
        )
        self._reconnect_max_backoff_seconds = float(
            extra.get("reconnect_max_backoff_seconds")
            or os.getenv(
                "WEBCHAT_RECONNECT_MAX_BACKOFF_SECONDS",
                str(DEFAULT_RECONNECT_MAX_BACKOFF_SECONDS),
            )
        )
        self._poll_task: Optional[asyncio.Task] = None
        self._client: Optional[httpx.AsyncClient] = None

    def _headers(self) -> Dict[str, str]:
        headers = {"Accept": "application/json"}
        if self._service_token:
            headers["Authorization"] = f"Bearer {self._service_token}"
        return headers

    def _assistant_url(self, conversation_id: str) -> str:
        return f"{self._base_url}/api/internal/hermes/conversations/{conversation_id}/assistant"

    def _title_url(self, conversation_id: str) -> str:
        return f"{self._base_url}/api/internal/hermes/conversations/{conversation_id}/title"

    def _typing_url(self, conversation_id: str) -> str:
        return f"{self._base_url}/api/internal/hermes/conversations/{conversation_id}/typing"

    def _stop_typing_url(self, conversation_id: str) -> str:
        return f"{self._base_url}/api/internal/hermes/conversations/{conversation_id}/typing/stop"

    def _commands_url(self) -> str:
        return f"{self._base_url}/api/internal/hermes/commands"

    async def _open_client(self) -> None:
        await self._close_client()
        self._client = httpx.AsyncClient(timeout=self._timeout_seconds)

    async def _close_client(self) -> None:
        if self._client is None:
            return
        await self._client.aclose()
        self._client = None

    async def _verify_connection(self) -> None:
        if self._client is None:
            raise RuntimeError("webchat client is not initialized")

        response = await self._client.get(
            f"{self._base_url}/api/internal/hermes/health",
            headers=self._headers(),
        )
        response.raise_for_status()
        await self._sync_slash_commands_with_retry()

    async def _establish_client(self) -> None:
        await self._open_client()
        try:
            await self._verify_connection()
        except Exception:
            await self._close_client()
            raise

    def _is_auth_error(self, exc: Exception) -> bool:
        if not HTTPX_AVAILABLE or not isinstance(exc, httpx.HTTPStatusError):
            return False
        status_code = exc.response.status_code if exc.response is not None else None
        return status_code in {401, 403}

    async def _reconnect_poll_client(self, exc: Exception) -> bool:
        await self._close_client()
        attempt = 0
        while self.is_connected:
            attempt += 1
            try:
                await self._establish_client()
                logger.info(
                    "[%s] Reconnected webchat poller after %s attempt%s",
                    self.name,
                    attempt,
                    "" if attempt == 1 else "s",
                )
                return True
            except asyncio.CancelledError:
                raise
            except Exception as reconnect_exc:
                delay_seconds = min(
                    self._reconnect_backoff_seconds * (2 ** (attempt - 1)),
                    self._reconnect_max_backoff_seconds,
                )
                log_message = (
                    "Authentication failed while reconnecting webchat poller"
                    if self._is_auth_error(reconnect_exc)
                    else "Failed to reconnect webchat poller"
                )
                logger.warning(
                    "[%s] %s on attempt %s; retrying in %.1fs: %s",
                    self.name,
                    log_message,
                    attempt,
                    delay_seconds,
                    reconnect_exc,
                )
                await asyncio.sleep(delay_seconds)
        return False

    async def fetch_conversation_context(self, context_url: str) -> Optional[Dict[str, Any]]:
        if self._client is None:
            return None

        normalized_url = _normalize_webchat_context_url(self._base_url, context_url)
        if not normalized_url:
            return None

        response = await self._client.get(normalized_url, headers=self._headers())
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, dict) else None

    def _build_sender_trace(
        self,
        conversation_id: str,
        content: str,
        attachments: Optional[list[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        session_platform = os.getenv("HERMES_SESSION_PLATFORM", "")
        session_chat_id = os.getenv("HERMES_SESSION_CHAT_ID", "")
        attachment_list = attachments or []
        return {
            "traceId": str(uuid4()),
            "route": "webchat_adapter",
            "senderBaseUrl": self._base_url,
            "senderTargetUrl": self._assistant_url(conversation_id),
            "senderHostname": os.uname().nodename,
            "sessionPlatform": session_platform or None,
            "sessionChatId": session_chat_id or None,
            "attachmentCount": len(attachment_list),
            "attachmentNames": [
                str(attachment.get("fileName") or "attachment")
                for attachment in attachment_list
            ],
            "contentLength": len(content or ""),
            "startedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }

    async def connect(self) -> bool:
        if not HTTPX_AVAILABLE:
            logger.warning("[%s] httpx not installed", self.name)
            return False
        if not self._service_token:
            logger.warning("[%s] WEBCHAT_SERVICE_TOKEN is not configured", self.name)
            return False

        try:
            await self._establish_client()
        except Exception as exc:
            logger.error("[%s] Failed to connect to %s: %s", self.name, self._base_url, exc)
            return False

        self._mark_connected()
        self._poll_task = asyncio.create_task(self._poll_loop())
        self._background_tasks.add(self._poll_task)
        self._poll_task.add_done_callback(self._background_tasks.discard)
        logger.info("[%s] Connected to %s", self.name, self._base_url)
        return True

    async def _sync_slash_commands_with_retry(self) -> None:
        attempts = max(1, self._command_sync_retries)
        for attempt in range(1, attempts + 1):
            try:
                await self._sync_slash_commands()
                return
            except Exception:
                if attempt >= attempts:
                    raise
                backoff_seconds = min(
                    self._command_sync_backoff_seconds * (2 ** (attempt - 1)),
                    self._command_sync_max_backoff_seconds,
                )
                logger.warning(
                    "[%s] Slash command sync verification failed on attempt %s/%s; retrying in %.1fs",
                    self.name,
                    attempt,
                    attempts,
                    backoff_seconds,
                )
                await asyncio.sleep(backoff_seconds)

    async def _sync_slash_commands(self) -> None:
        if self._client is None:
            return

        from hermes_cli.commands import gateway_command_catalog

        commands = gateway_command_catalog()
        expected_count = len(commands)
        expected_hash = _command_catalog_hash(commands)

        response = await self._client.post(
            self._commands_url(),
            json={"commands": commands},
            headers=self._headers(),
        )
        response.raise_for_status()

        payload = response.json()
        if not isinstance(payload, dict) or payload.get("ok") is not True:
            raise RuntimeError("webchat did not acknowledge slash command sync")

        accepted_count = payload.get("acceptedCount")
        catalog_hash = payload.get("catalogHash")
        if accepted_count != expected_count or catalog_hash != expected_hash:
            raise RuntimeError(
                "webchat slash command acknowledgement mismatch "
                f"(expected count={expected_count}, hash={expected_hash}; "
                f"received count={accepted_count}, hash={catalog_hash})"
            )

    async def disconnect(self) -> None:
        self._mark_disconnected()
        if self._poll_task:
            self._poll_task.cancel()
            await asyncio.gather(self._poll_task, return_exceptions=True)
            self._poll_task = None
        await self._close_client()
        logger.info("[%s] Disconnected", self.name)

    async def _poll_loop(self) -> None:
        while self.is_connected:
            try:
                event = await self._fetch_event()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[%s] Poll error: %s", self.name, exc)
                if not await self._reconnect_poll_client(exc):
                    break
                continue

            if event is None:
                await asyncio.sleep(self._poll_interval)
                continue

            try:
                await self.handle_message(event)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[%s] Message handling error: %s", self.name, exc)
                await asyncio.sleep(self._poll_interval)

    async def _fetch_event(self) -> Optional[MessageEvent]:
        if self._client is None:
            return None

        response = await self._client.get(
            f"{self._base_url}/api/internal/hermes/inbox/next",
            headers=self._headers(),
        )
        if response.status_code == 204:
            return None
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            return None

        event_id = str(payload.get("eventId") or "").strip()
        if not event_id:
            return None

        conversation_id = str(
            payload.get("conversationId")
            or payload.get("chatId")
            or payload.get("sessionChatId")
            or event_id
        ).strip()
        if not conversation_id:
            conversation_id = event_id

        context_url = _normalize_webchat_context_url(
            self._base_url,
            payload.get("contextUrl"),
        )
        if context_url:
            payload["contextUrl"] = context_url

        media_urls, media_types = await self._materialize_attachments(
            payload.get("attachments") or []
        )

        created_at = str(payload.get("createdAt") or "").strip()
        timestamp = datetime.now()
        if created_at:
            try:
                timestamp = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            except ValueError:
                pass

        source = self.build_source(
            chat_id=conversation_id,
            chat_name=payload.get("conversationName"),
            chat_type=payload.get("chatType", "dm"),
            user_id=str(payload.get("userId") or payload.get("senderId") or "web-user"),
            user_name=payload.get("userName"),
            thread_id=payload.get("threadId"),
            message_id=str(payload.get("messageId") or event_id),
        )

        return MessageEvent(
            text=str(payload.get("text") or ""),
            message_type=self._derive_message_type(
                str(payload.get("text") or ""),
                media_types,
            ),
            source=source,
            raw_message=payload,
            message_id=str(payload.get("messageId") or event_id),
            media_urls=media_urls,
            media_types=media_types,
            reply_to_message_id=str(payload.get("replyToMessageId") or "") or None,
            timestamp=timestamp,
        )

    @staticmethod
    def _resolve_attachment_content_type(file_name: str, content_type: str) -> str:
        normalized = str(content_type or "application/octet-stream").strip().lower()
        if normalized and normalized != "application/octet-stream":
            return str(content_type or "application/octet-stream").strip()

        guessed, _ = mimetypes.guess_type(str(file_name or "").strip())
        return guessed or "application/octet-stream"

    async def _materialize_attachments(
        self,
        attachments: list[dict[str, Any]],
    ) -> tuple[list[str], list[str]]:
        media_urls: list[str] = []
        media_types: list[str] = []
        if self._client is None:
            return media_urls, media_types

        for attachment in attachments:
            attachment_id = attachment.get("attachmentId")
            if not attachment_id:
                continue

            file_name = str(attachment.get("fileName") or attachment_id)
            content_type = self._resolve_attachment_content_type(
                file_name,
                str(attachment.get("contentType") or "application/octet-stream"),
            )
            download_url = attachment.get("internalDownloadUrl") or (
                f"/api/internal/hermes/attachments/{attachment_id}/download"
            )
            if str(download_url).startswith("/"):
                download_url = f"{self._base_url}{download_url}"

            try:
                response = await self._client.get(str(download_url), headers=self._headers())
                response.raise_for_status()
                data = response.content
                ext = Path(file_name).suffix or mimetypes.guess_extension(content_type) or ""

                if content_type.startswith("image/"):
                    cached = cache_image_from_bytes(data, ext or ".png")
                elif content_type.startswith("audio/"):
                    cached = cache_audio_from_bytes(data, ext or ".ogg")
                else:
                    cached = cache_document_from_bytes(data, file_name)

                media_urls.append(cached)
                media_types.append(content_type)
            except Exception as exc:
                logger.warning(
                    "[%s] Failed to download attachment %s: %s",
                    self.name,
                    attachment_id,
                    exc,
                )

        return media_urls, media_types

    @staticmethod
    def _derive_message_type(text: str, media_types: list[str]) -> MessageType:
        if any(media_type.startswith("image/") for media_type in media_types):
            return MessageType.TEXT if text else MessageType.PHOTO
        if any(media_type.startswith("audio/") for media_type in media_types):
            return MessageType.TEXT if text else MessageType.AUDIO
        if media_types:
            return MessageType.DOCUMENT
        return MessageType.TEXT

    async def _ack_event(self, event_id: str) -> None:
        if self._client is None:
            return
        response = await self._client.post(
            f"{self._base_url}/api/internal/hermes/events/{event_id}/ack",
            headers=self._headers(),
        )
        response.raise_for_status()

    @staticmethod
    def _event_id_from_message(event: MessageEvent) -> Optional[str]:
        payload = event.raw_message if isinstance(event.raw_message, dict) else {}
        event_id = str(payload.get("eventId") or "").strip()
        return event_id or None

    def _event_status_url(self, event_id: str) -> str:
        return f"{self._base_url}/api/internal/hermes/events/{event_id}"

    async def _fetch_event_cancelled(self, event_id: str) -> bool:
        if self._client is None or not event_id:
            return False
        try:
            response = await self._client.get(
                self._event_status_url(event_id),
                headers=self._headers(),
            )
            if response.status_code == 404:
                return False
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                return False
            return payload.get("cancelled") is True or payload.get("status") == "cancelled"
        except Exception as exc:
            logger.debug("[%s] Failed to fetch cancellation status for %s: %s", self.name, event_id, exc)
            return False

    def _start_user_cancel_watcher(
        self,
        event: MessageEvent,
        session_key: str,
    ) -> Optional[asyncio.Task]:
        event_id = self._event_id_from_message(event)
        if not event_id or event.source is None:
            return None

        chat_id = event.source.chat_id

        async def _watch() -> None:
            try:
                while True:
                    await asyncio.sleep(self._poll_interval)
                    if await self._fetch_event_cancelled(event_id):
                        logger.info(
                            "[%s] User cancelled event %s — interrupting session %s",
                            self.name,
                            event_id,
                            session_key,
                        )
                        await self.interrupt_session_activity(session_key, chat_id)
                        return
            except asyncio.CancelledError:
                raise

        task = asyncio.create_task(_watch())
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)
        return task

    async def _stop_user_cancel_watcher(self, watcher: Optional[asyncio.Task]) -> None:
        if watcher is None:
            return
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)

    async def _process_message_background(self, event: MessageEvent, session_key: str) -> None:
        watcher = self._start_user_cancel_watcher(event, session_key)
        try:
            await super()._process_message_background(event, session_key)
        finally:
            await self._stop_user_cancel_watcher(watcher)

    def _cancelled_event_was_superseded(self, event: MessageEvent) -> bool:
        current_task = asyncio.current_task()
        if current_task is None or event.source is None:
            return False

        session_key = build_session_key(
            event.source,
            group_sessions_per_user=self.config.extra.get("group_sessions_per_user", True),
            thread_sessions_per_user=self.config.extra.get("thread_sessions_per_user", False),
        )
        if session_key not in self._active_sessions:
            return False

        owner_task = self._session_tasks.get(session_key)
        return owner_task is not current_task

    async def on_processing_complete(self, event: MessageEvent, outcome: ProcessingOutcome) -> None:
        payload = event.raw_message if isinstance(event.raw_message, dict) else {}
        event_id = payload.get("eventId")
        if not event_id:
            return

        if outcome is ProcessingOutcome.CANCELLED:
            if await self._fetch_event_cancelled(str(event_id)):
                logger.info(
                    "[%s] Acknowledging user-cancelled event %s",
                    self.name,
                    event_id,
                )
                await self._ack_event(str(event_id))
                return
            if self._cancelled_event_was_superseded(event):
                logger.info(
                    "[%s] Acknowledging superseded cancelled event %s",
                    self.name,
                    event_id,
                )
                await self._ack_event(str(event_id))
                return

        if outcome is not ProcessingOutcome.SUCCESS:
            logger.warning(
                "[%s] Leaving event %s unacked after %s so it can be retried",
                self.name,
                event_id,
                outcome.value,
            )
            return

        await self._ack_event(str(event_id))

    async def send_typing(self, chat_id: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        if self._client is None:
            return
        try:
            await self._client.post(self._typing_url(chat_id), headers=self._headers())
        except Exception as exc:
            logger.debug("[%s] Failed to send typing indicator: %s", self.name, exc)

    async def stop_typing(self, chat_id: str) -> None:
        if self._client is None:
            return
        try:
            await self._client.post(self._stop_typing_url(chat_id), headers=self._headers())
        except Exception as exc:
            logger.debug("[%s] Failed to stop typing indicator: %s", self.name, exc)

    async def apply_session_title(self, source, session_id: str, title: str) -> bool:
        if self._client is None:
            return False

        conversation_id = str(getattr(source, "chat_id", "") or "").strip()
        cleaned = (title or "").strip()
        if not conversation_id or not cleaned:
            return False

        try:
            response = await self._client.post(
                self._title_url(conversation_id),
                headers=self._headers(),
                json={"title": cleaned, "sessionId": session_id},
            )
            response.raise_for_status()
            return True
        except Exception as exc:
            logger.warning("[%s] Failed to apply session title: %s", self.name, exc)
            return False

    def create_title_callback(self, ctx: dict) -> Optional[Callable[[str], None]]:
        """Push Hermes auto-titles to the WebUI conversation list."""
        source = ctx.get("source")
        session_id = ctx.get("session_id")
        loop = ctx.get("loop")
        safe_schedule = ctx.get("safe_schedule")
        log = ctx.get("logger") or logger

        if source is None or not callable(safe_schedule):
            return None
        if loop is None or getattr(loop, "is_closed", lambda: True)():
            return None

        try:
            copied_source = dataclasses.replace(source)
        except Exception:
            copied_source = source

        def _callback(title: str) -> None:
            cleaned = (title or "").strip()
            if not cleaned:
                return

            async def _apply() -> None:
                try:
                    await self.apply_session_title(copied_source, session_id, cleaned)
                except Exception:
                    log.debug(
                        "Failed to apply session title via webchat adapter",
                        exc_info=True,
                    )

            future = safe_schedule(
                _apply(),
                loop,
                logger=log,
                log_message="webchat session title update failed to schedule",
            )
            if future is None:
                return

            def _log_title_failure(fut) -> None:
                try:
                    fut.result()
                except Exception:
                    log.debug("webchat session title update failed", exc_info=True)

            try:
                future.add_done_callback(_log_title_failure)
            except Exception:
                pass

        return _callback

    async def edit_message(
        self,
        chat_id: str,
        message_id: str,
        content: str,
        *,
        finalize: bool = False,
    ) -> SendResult:
        try:
            return await self._post_assistant_message(
                chat_id=chat_id,
                content=content,
                message_id=message_id,
            )
        except Exception as exc:
            logger.warning(
                "[%s] Failed to edit webchat message %s: %s",
                self.name,
                message_id,
                exc,
            )
            return SendResult(success=False, error=f"Webchat edit failed: {exc}", retryable=True)

    async def send(
        self,
        chat_id: str,
        content: str,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SendResult:
        try:
            from .timings_buffer import enrich_send_metadata

            metadata = enrich_send_metadata(content, metadata)
            update_message_id: Optional[str] = None
            transport_metadata = metadata
            if isinstance(metadata, dict):
                raw_message_id = metadata.get("message_id")
                if isinstance(raw_message_id, str) and raw_message_id.strip():
                    update_message_id = raw_message_id.strip()
                    transport_metadata = {
                        key: value
                        for key, value in metadata.items()
                        if key != "message_id"
                    }
                    if not transport_metadata:
                        transport_metadata = None
            return await self._post_assistant_message(
                chat_id=chat_id,
                content=content,
                reply_to=reply_to,
                metadata=transport_metadata,
                message_id=update_message_id,
            )
        except Exception as exc:
            return SendResult(success=False, error=f"Webchat send failed: {exc}", retryable=True)

    async def _post_assistant_message(
        self,
        chat_id: str,
        content: str = "",
        attachments: Optional[list[Dict[str, Any]]] = None,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        message_id: Optional[str] = None,
    ) -> SendResult:
        if self._client is None:
            return SendResult(success=False, error="Webchat adapter is not connected")

        payload: Dict[str, Any] = {
            "conversationId": chat_id,
            "content": content,
            "publicBaseUrl": self._public_base_url,
        }
        if message_id:
            payload["messageId"] = message_id
        if attachments:
            payload["attachments"] = attachments
        if reply_to:
            payload["replyToMessageId"] = reply_to
        if isinstance(metadata, dict) and metadata:
            timings = metadata.get("timings")
            message_role = metadata.get("message_role")
            display_type = metadata.get("display_type")
            tool_calls = metadata.get("tool_calls")
            tool_call_id = metadata.get("tool_call_id")
            parent_message_id = metadata.get("parent_message_id")
            user_message_id = metadata.get("user_message_id")
            if timings:
                payload["timings"] = timings
            if message_role in {"assistant", "system", "tool"}:
                payload["role"] = message_role
            if display_type == "tool_progress":
                payload["displayType"] = display_type
            if tool_calls:
                payload["toolCalls"] = tool_calls
            if tool_call_id:
                payload["toolCallId"] = tool_call_id
            if parent_message_id:
                payload["parentMessageId"] = parent_message_id
            if user_message_id:
                payload["userMessageId"] = user_message_id
            filtered_metadata = {
                key: value
                for key, value in metadata.items()
                if key
                not in {
                    "timings",
                    "message_role",
                    "display_type",
                    "tool_calls",
                    "tool_call_id",
                    "parent_message_id",
                    "user_message_id",
                }
            }
            if filtered_metadata:
                payload["metadata"] = filtered_metadata
        elif metadata:
            payload["metadata"] = metadata

        payload["senderTrace"] = self._build_sender_trace(chat_id, content, attachments)

        response = await self._client.post(
            self._assistant_url(chat_id),
            json=payload,
            headers=self._headers(),
        )
        response.raise_for_status()
        data = response.json()
        return SendResult(
            success=True,
            message_id=str(data.get("messageId") or data.get("id") or ""),
            raw_response=data,
        )

    @staticmethod
    def _serialize_tool_calls_for_webui(tool_calls: Any) -> Optional[list[Dict[str, Any]]]:
        if not isinstance(tool_calls, list) or not tool_calls:
            return None
        serialized: list[Dict[str, Any]] = []
        for raw_call in tool_calls:
            if not isinstance(raw_call, dict):
                continue
            call_id = str(raw_call.get("id") or "").strip()
            function = raw_call.get("function")
            if isinstance(function, dict):
                name = str(function.get("name") or "").strip()
                arguments = function.get("arguments")
            else:
                name = str(raw_call.get("name") or "").strip()
                arguments = raw_call.get("arguments")
            if not call_id or not name:
                continue
            if arguments is None:
                arguments = "{}"
            elif not isinstance(arguments, str):
                arguments = json.dumps(arguments, separators=(",", ":"), ensure_ascii=False)
            serialized.append(
                {
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": arguments},
                }
            )
        return serialized or None

    @staticmethod
    def _serialize_tool_result_content(content: Any) -> str:
        if isinstance(content, str):
            return content
        if content is None:
            return ""
        if isinstance(content, list):
            try:
                return json.dumps(content, ensure_ascii=False)
            except (TypeError, ValueError):
                return str(content)
        try:
            return json.dumps(content, ensure_ascii=False)
        except (TypeError, ValueError):
            return str(content)

    async def persist_transcript_message(
        self,
        chat_id: str,
        message: Dict[str, Any],
        *,
        user_message_id: Optional[str] = None,
        parent_message_id: Optional[str] = None,
    ) -> SendResult:
        role = str(message.get("role") or "").strip().lower()
        metadata: Dict[str, Any] = {"message_role": role}
        if user_message_id:
            metadata["user_message_id"] = user_message_id
        if parent_message_id:
            metadata["parent_message_id"] = parent_message_id

        if role == "tool":
            tool_call_id = str(message.get("tool_call_id") or "").strip()
            if not tool_call_id:
                return SendResult(success=False, error="tool message missing tool_call_id")
            metadata["tool_call_id"] = tool_call_id
            content = self._serialize_tool_result_content(message.get("content"))
            return await self._post_assistant_message(
                chat_id=chat_id,
                content=content,
                metadata=metadata,
            )

        if role != "assistant":
            return SendResult(success=False, error=f"unsupported transcript role: {role}")

        tool_calls = self._serialize_tool_calls_for_webui(message.get("tool_calls"))
        if tool_calls:
            metadata["tool_calls"] = tool_calls
        content = str(message.get("content") or "")
        return await self._post_assistant_message(
            chat_id=chat_id,
            content=content,
            metadata=metadata,
        )

    @staticmethod
    def _build_json_attachment(file_path: str, file_name: Optional[str] = None) -> Dict[str, Any]:
        resolved_path = Path(file_path)
        attachment_name = file_name or resolved_path.name
        content_type = mimetypes.guess_type(attachment_name)[0] or "application/octet-stream"
        encoded = base64.b64encode(resolved_path.read_bytes()).decode("ascii")
        return {
            "fileName": attachment_name,
            "contentType": content_type,
            "base64Data": encoded,
        }

    async def _send_file(
        self,
        chat_id: str,
        file_path: str,
        caption: Optional[str] = None,
        file_name: Optional[str] = None,
    ) -> SendResult:
        try:
            attachment = self._build_json_attachment(file_path, file_name=file_name)
            return await self._post_assistant_message(
                chat_id=chat_id,
                content=caption or "",
                attachments=[attachment],
            )
        except Exception as exc:
            return SendResult(success=False, error=f"Webchat file send failed: {exc}", retryable=True)

    async def send_document(
        self,
        chat_id: str,
        file_path: str,
        caption: Optional[str] = None,
        file_name: Optional[str] = None,
        reply_to: Optional[str] = None,
        **kwargs,
    ) -> SendResult:
        return await self._send_file(chat_id, file_path, caption, file_name=file_name)

    async def send_image_file(
        self,
        chat_id: str,
        image_path: str,
        caption: Optional[str] = None,
        reply_to: Optional[str] = None,
        **kwargs,
    ) -> SendResult:
        return await self._send_file(chat_id, image_path, caption)

    async def send_video(
        self,
        chat_id: str,
        video_path: str,
        caption: Optional[str] = None,
        reply_to: Optional[str] = None,
        **kwargs,
    ) -> SendResult:
        return await self._send_file(chat_id, video_path, caption)

    async def send_voice(
        self,
        chat_id: str,
        audio_path: str,
        caption: Optional[str] = None,
        reply_to: Optional[str] = None,
        **kwargs,
    ) -> SendResult:
        return await self._send_file(chat_id, audio_path, caption)

    async def send_animation(
        self,
        chat_id: str,
        animation_url: str,
        caption: Optional[str] = None,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SendResult:
        if animation_url.startswith(("http://", "https://")):
            content = f"![{caption or ''}]({animation_url})" if caption else f"![]({animation_url})"
            return await self.send(chat_id=chat_id, content=content, reply_to=reply_to, metadata=metadata)
        return await self._send_file(chat_id, animation_url, caption)

    async def send_image(
        self,
        chat_id: str,
        image_url: str,
        caption: Optional[str] = None,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SendResult:
        if image_url.startswith(("http://", "https://")):
            parts = []
            if caption:
                parts.append(caption)
            parts.append(f"![]({image_url})")
            return await self.send(
                chat_id=chat_id,
                content="\n\n".join(parts),
                reply_to=reply_to,
                metadata=metadata,
            )
        return await self._send_file(chat_id, image_url, caption)

    def enrich_delivery_metadata(
        self,
        metadata: Optional[Dict[str, Any]],
        event: Any,
    ) -> Optional[Dict[str, Any]]:
        timings = getattr(event, "_hermes_timings", None)
        if timings:
            metadata = dict(metadata or {})
            metadata["timings"] = timings
        return metadata

    async def get_chat_info(self, chat_id: str) -> Dict[str, Any]:
        return {
            "name": f"Webchat conversation {chat_id}",
            "type": "dm",
            "chat_id": chat_id,
            "public_base_url": self._public_base_url,
        }


def _truthy_env(name: str) -> bool:
    return os.getenv(name, "").lower() in ("true", "1", "yes")


def _env_enablement() -> Optional[Dict[str, Any]]:
    """Seed PlatformConfig from WEBCHAT_* env vars during gateway config load."""
    enabled = _truthy_env("WEBCHAT_ENABLED")
    url = os.getenv("WEBCHAT_URL", "").strip()
    token = os.getenv("WEBCHAT_SERVICE_TOKEN", "").strip()
    if not (enabled or url or token):
        return None

    seed: Dict[str, Any] = {}
    if url:
        seed["url"] = url
    public_base_url = os.getenv("WEBCHAT_PUBLIC_BASE_URL", "").strip()
    if public_base_url:
        seed["public_base_url"] = public_base_url
    poll_interval = os.getenv("WEBCHAT_POLL_INTERVAL", "").strip()
    if poll_interval:
        try:
            seed["poll_interval"] = float(poll_interval)
        except ValueError:
            pass
    if token:
        seed["service_token"] = token

    home = os.getenv("WEBCHAT_HOME_CHANNEL", "").strip()
    if home:
        seed["home_channel"] = {
            "chat_id": home,
            "name": os.getenv("WEBCHAT_HOME_CHANNEL_NAME", "Home"),
        }
    return seed or None


def _apply_yaml_config(yaml_cfg: dict, platform_cfg: dict) -> Optional[Dict[str, Any]]:
    """Translate gateway.platforms.webchat YAML into PlatformConfig.extra."""
    extra = dict((platform_cfg.get("extra") or {}))
    if yaml_cfg.get("url") and not extra.get("url"):
        extra["url"] = yaml_cfg["url"]
    if yaml_cfg.get("public_base_url") and not extra.get("public_base_url"):
        extra["public_base_url"] = yaml_cfg["public_base_url"]
    if yaml_cfg.get("poll_interval") is not None and "poll_interval" not in extra:
        extra["poll_interval"] = yaml_cfg["poll_interval"]
    token = platform_cfg.get("token") or yaml_cfg.get("token")
    if token and not os.getenv("WEBCHAT_SERVICE_TOKEN"):
        os.environ.setdefault("WEBCHAT_SERVICE_TOKEN", str(token))
    return extra or None


def _webchat_configured() -> bool:
    """Return True when httpx is available and WebChat env hints are present."""
    if not HTTPX_AVAILABLE:
        return False
    if _truthy_env("WEBCHAT_ENABLED"):
        return True
    if os.getenv("WEBCHAT_URL", "").strip():
        return True
    if os.getenv("WEBCHAT_SERVICE_TOKEN", "").strip():
        return True
    return False


def register(ctx):
    """Plugin entry point: called by the Hermes plugin system."""
    import importlib.util
    import sys
    from pathlib import Path

    plugin_dir = Path(__file__).resolve().parent
    tools_path = plugin_dir / "tools.py"
    hooks_path = plugin_dir / "gateway_hooks.py"
    tools_name = "webui_plugin_tools"
    hooks_name = "webui_plugin_gateway_hooks"

    def _load(name: str, path: Path):
        if name in sys.modules:
            return sys.modules[name]
        spec = importlib.util.spec_from_file_location(name, path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot load WebUI plugin module from {path}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module

    tools_mod = _load(tools_name, tools_path)
    hooks_mod = _load(hooks_name, hooks_path)
    timings_mod = _load("webui_plugin_timings_buffer", plugin_dir / "timings_buffer.py")
    tools_mod.register_tools(ctx)
    ctx.register_hook("post_api_request", timings_mod.on_post_api_request)
    ctx.register_platform(
        name="webchat",
        label="WebChat",
        adapter_factory=lambda cfg: WebChatAdapter(cfg),
        check_fn=check_webchat_requirements,
        validate_config=lambda cfg: bool(
            (getattr(cfg, "token", None) or os.getenv("WEBCHAT_SERVICE_TOKEN", ""))
            and (
                (getattr(cfg, "extra", {}) or {}).get("url")
                or os.getenv("WEBCHAT_URL", "")
            )
        ),
        is_connected=lambda cfg: bool(
            (getattr(cfg, "token", None) or os.getenv("WEBCHAT_SERVICE_TOKEN", ""))
            and (
                (getattr(cfg, "extra", {}) or {}).get("url")
                or os.getenv("WEBCHAT_URL", "")
            )
        ),
        required_env=["WEBCHAT_SERVICE_TOKEN", "WEBCHAT_URL"],
        install_hint="pip install httpx",
        env_enablement_fn=_env_enablement,
        apply_yaml_config_fn=_apply_yaml_config,
        cron_deliver_env_var="WEBCHAT_HOME_CHANNEL",
        allow_all_env="WEBCHAT_ALLOW_ALL_USERS",
        max_message_length=65536,
        pii_safe=False,
        emoji="🌐",
        platform_hint=(
            "You are chatting via the browser WebUI. Markdown and file attachments "
            "are supported. Keep responses readable in a chat transcript."
        ),
        gateway_hooks=hooks_mod.WEBCHAT_GATEWAY_HOOKS,
    )
