"""Gateway runner hooks for the WebUI / WebChat platform."""

from __future__ import annotations

import importlib.util
import logging
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from gateway.platform_registry import GatewayPlatformHooks

logger = logging.getLogger(__name__)

_ADAPTER_SYMBOLS: dict[str, Any] = {}


def _adapter_api():
    if not _ADAPTER_SYMBOLS:
        import importlib.util
        import sys

        plugin_dir = Path(__file__).resolve().parent
        plugin_dir_str = str(plugin_dir)
        if plugin_dir_str not in sys.path:
            sys.path.insert(0, plugin_dir_str)

        path = plugin_dir / "adapter.py"
        spec = importlib.util.spec_from_file_location("webui_plugin_adapter_api", path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot load adapter API from {path}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _ADAPTER_SYMBOLS.update(
            {
                "WebChatAdapter": module.WebChatAdapter,
                "build_webchat_context_marker": module.build_webchat_context_marker,
                "build_webchat_context_transcript": module.build_webchat_context_transcript,
                "export_lacks_tool_round_trip": module.export_lacks_tool_round_trip,
                "transcript_has_tool_round_trip": module.transcript_has_tool_round_trip,
            }
        )
    return _ADAPTER_SYMBOLS


_BUFFERABLE_STATUS_MARKERS = (
    "retrying in",
    "rate limit reached",
    "max retries",
    "api failed after",
    "rate limited after",
    "giving up",
    "trying fallback",
)


class WebChatGatewayHooks(GatewayPlatformHooks):
  trusted_auth = True

  async def reconcile_session_history(
      self,
      *,
      runner: Any,
      session_entry: Any,
      event: Any,
      source: Any,
      history: list,
      adapter: Any,
  ) -> list:
      raw_payload = event.raw_message if isinstance(event.raw_message, dict) else None
      if not raw_payload:
          return history

      context_url = str(raw_payload.get("contextUrl") or "").strip()
      if not context_url:
          return history

      fetch_context = getattr(adapter, "fetch_conversation_context", None) if adapter else None
      if not callable(fetch_context):
          return history

      try:
          api = _adapter_api()
          context_payload = await fetch_context(context_url)
          marker = api["build_webchat_context_marker"](context_payload or {})

          raw_context_version = raw_payload.get("contextVersion")
          if marker and isinstance(raw_context_version, dict):
              expected_curr_node = str(raw_context_version.get("currNode") or "").strip() or None
              marker_curr_node = str(marker.get("currNode") or "").strip() or None
              expected_conversation_id = str(raw_payload.get("conversationId") or "").strip() or None
              marker_conversation_id = str(marker.get("conversationId") or "").strip() or None

              try:
                  expected_last_modified = int(raw_context_version.get("lastModified") or 0)
              except (TypeError, ValueError):
                  expected_last_modified = 0

              try:
                  marker_last_modified = int(marker.get("lastModified") or 0)
              except (TypeError, ValueError):
                  marker_last_modified = 0

              if (
                  expected_conversation_id
                  and marker_conversation_id
                  and marker_conversation_id != expected_conversation_id
              ):
                  logger.warning(
                      "[gateway] Ignoring reconciled webchat context for chat=%s session=%s: "
                      "conversation mismatch payload=%s fetched=%s",
                      source.chat_id or "unknown",
                      session_entry.session_id,
                      expected_conversation_id,
                      marker_conversation_id,
                  )
                  return history

              if (
                  expected_last_modified > 0
                  and marker_last_modified > 0
                  and marker_last_modified < expected_last_modified
              ):
                  logger.warning(
                      "[gateway] Ignoring stale reconciled webchat context for chat=%s session=%s: "
                      "payload lastModified=%s fetched=%s",
                      source.chat_id or "unknown",
                      session_entry.session_id,
                      expected_last_modified,
                      marker_last_modified,
                  )
                  return history

              if (
                  expected_last_modified > 0
                  and marker_last_modified == expected_last_modified
                  and expected_curr_node
                  and marker_curr_node
                  and marker_curr_node != expected_curr_node
              ):
                  logger.warning(
                      "[gateway] Ignoring mismatched reconciled webchat context for chat=%s session=%s: "
                      "payload curr_node=%s fetched=%s at lastModified=%s",
                      source.chat_id or "unknown",
                      session_entry.session_id,
                      expected_curr_node,
                      marker_curr_node,
                      expected_last_modified,
                  )
                  return history

          if (
              history
              and api["transcript_has_tool_round_trip"](history)
              and api["export_lacks_tool_round_trip"](context_payload or {})
          ):
              logger.info(
                  "[gateway] Keeping webchat session transcript for chat=%s session=%s; "
                  "page export has UI breadcrumbs only (no tool_calls/tool rows)",
                  source.chat_id or "unknown",
                  session_entry.session_id,
              )
              return history

          next_history = api["build_webchat_context_transcript"](
              context_payload or {},
              exclude_message_id=event.message_id,
          )
          if not next_history:
              return history

          runner.session_store.rewrite_transcript(session_entry.session_id, next_history)
          marker = next_history[0].get("webchat_context") if next_history else marker
          logger.info(
              "[gateway] Reconciled webchat session %s from page context chat=%s messages=%d curr_node=%s",
              session_entry.session_id,
              source.chat_id or "unknown",
              max(0, len(next_history) - 1),
              marker.get("currNode") if isinstance(marker, dict) else None,
          )
          return next_history
      except Exception as exc:
          logger.warning(
              "[gateway] Failed to reconcile webchat context for chat=%s session=%s: %s",
              source.chat_id or "unknown",
              session_entry.session_id,
              exc,
          )
          return history

  def enrich_progress_metadata(self, metadata: Optional[dict]) -> Optional[dict]:
      metadata = dict(metadata or {})
      metadata.update(
          {
              "display_type": "tool_progress",
              "message_role": "system",
          }
      )
      return metadata

  def system_message_metadata(self, base_metadata: Optional[dict]) -> Optional[dict]:
      metadata = dict(base_metadata or {})
      metadata["message_role"] = "system"
      return metadata or None

  def should_buffer_lifecycle_status(self, message: str) -> bool:
      normalized = (message or "").strip().lower()
      if not normalized:
          return False
      return any(marker in normalized for marker in _BUFFERABLE_STATUS_MARKERS)

  def create_transcript_callback(self, ctx: dict) -> Optional[Callable[[Dict[str, Any]], None]]:
      source = ctx["source"]
      adapter = ctx["adapter"]
      loop = ctx["loop"]
      run_still_current = ctx["run_still_current"]
      safe_schedule = ctx["safe_schedule"]
      event_message_id = ctx.get("event_message_id")
      log = ctx.get("logger") or logger

      if type(adapter).__name__ != "WebChatAdapter":
          return None

      state: Dict[str, Optional[str]] = {"last_assistant_message_id": None}

      async def _persist(msg: Dict[str, Any]) -> None:
          role = msg.get("role")
          if role == "assistant" and msg.get("tool_calls"):
              result = await adapter.persist_transcript_message(
                  source.chat_id,
                  msg,
                  user_message_id=event_message_id,
              )
              if result.success and result.message_id:
                  state["last_assistant_message_id"] = result.message_id
          elif role == "tool":
              await adapter.persist_transcript_message(
                  source.chat_id,
                  msg,
                  user_message_id=event_message_id,
                  parent_message_id=state.get("last_assistant_message_id"),
              )

      def _callback(msg: Dict[str, Any]) -> None:
          if not run_still_current():
              return
          safe_schedule(
              _persist(msg),
              loop,
              logger=log,
              log_message="webchat_transcript_callback scheduling error",
          )

      return _callback

  def merge_error_buffer(
      self,
      buffer: list[str],
      text: str,
      *,
      failed: bool,
  ) -> str:
      if not buffer:
          return text
      details = "\n".join(buffer)
      if not text:
          return f"Retry details:\n{details}"
      if failed and details not in text:
          return f"{text}\n\nRetry details:\n{details}"
      if not failed and "Retry details:" not in text:
          return f"{text}\n\nRetry details:\n{details}"
      return text

  async def reconcile_preview_timings(self, ctx: dict) -> None:
      response = ctx.get("response") or {}
      adapter = ctx.get("adapter")
      chat_id = ctx.get("chat_id")
      thread_metadata = ctx.get("thread_metadata")
      preview_future = ctx.get("preview_future")
      if not preview_future or not adapter or not chat_id:
          return
      try:
          preview_result = preview_future.result(timeout=5.0)
          preview_message_id = getattr(preview_result, "message_id", "") or ""
          if not preview_message_id:
              logger.debug("Previewed webchat reply had no message id; timings reconciliation skipped")
              return
          reconcile_metadata = dict(thread_metadata or {})
          reconcile_metadata["message_id"] = preview_message_id
          reconcile_metadata["timings"] = response.get("timings")
          message_role = response.get("message_role")
          if message_role in {"assistant", "system"}:
              reconcile_metadata["message_role"] = message_role
          reconcile_result = await adapter.send(
              chat_id,
              response.get("final_response") or "",
              metadata=reconcile_metadata,
          )
          if not getattr(reconcile_result, "success", False):
              logger.warning(
                  "Failed to reconcile previewed webchat reply %s with timings: %s",
                  preview_message_id,
                  getattr(reconcile_result, "error", "unknown error"),
              )
      except Exception as exc:
          logger.debug("Could not reconcile previewed webchat timings: %s", exc)

  def enrich_busy_message_metadata(self, thread_meta: Optional[dict]) -> Optional[dict]:
      metadata = dict(thread_meta or {})
      metadata["message_role"] = "system"
      return metadata


WEBCHAT_GATEWAY_HOOKS = WebChatGatewayHooks(trusted_auth=True)
