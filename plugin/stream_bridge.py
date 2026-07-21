"""Translate GatewayStreamConsumer full-text edits into WebUI delta/seq posts.

Hermes ``GatewayStreamConsumer`` calls ``send`` / ``edit_message`` with the
*full* accumulated assistant text (plus an optional cursor). WebUI's chunk API
expects OpenAI-like incremental ``{delta, seq, done, messageId}`` posts so the
browser can grow a ``status=streaming`` bubble.

This helper strips the streaming cursor and converts successive full strings
into suffix deltas when content is a prefix extension of the last posted text.

Adapters with ``REQUIRES_EDIT_FINALIZE`` may call finalize more than once with
the same content. Those duplicate finalizes must be idempotent — otherwise the
full reply is appended a second time and the UI appears to "jump" or change.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


DEFAULT_STREAMING_CURSORS = (
    " ▉",
    "▉",
    " ▌",
    "▌",
)


def strip_streaming_cursor(text: str, cursors: tuple[str, ...] = DEFAULT_STREAMING_CURSORS) -> str:
    value = text or ""
    for cursor in cursors:
        if cursor and value.endswith(cursor):
            return value[: -len(cursor)]
    return value


@dataclass
class StreamBridgeState:
    message_id: Optional[str] = None
    last_visible: str = ""
    next_seq: int = 0
    finalized: bool = False


@dataclass
class StreamBridgeAction:
    """Instruction for the adapter HTTP layer."""

    kind: str  # "delta" | "done" | "passthrough"
    delta: str = ""
    seq: int = 0
    message_id: Optional[str] = None
    done: bool = False
    content: Optional[str] = None  # final assembled text when done
    # When True, caller should use the classic full-content create/update path.
    passthrough: bool = False
    # Duplicate finalize after the stream already closed — caller should no-op.
    noop: bool = False


def begin_stream_delta(
    state: StreamBridgeState,
    full_text: str,
    *,
    message_id: Optional[str] = None,
) -> StreamBridgeAction:
    """First visible frame for a streaming segment."""
    visible = strip_streaming_cursor(full_text)
    state.message_id = message_id
    state.last_visible = visible
    state.next_seq = 1 if visible else 0
    state.finalized = False
    return StreamBridgeAction(
        kind="delta",
        delta=visible,
        seq=0,
        message_id=message_id,
        done=False,
    )


def edit_stream_delta(
    state: StreamBridgeState,
    full_text: str,
    *,
    finalize: bool = False,
) -> StreamBridgeAction:
    """Mid-stream or final edit from GatewayStreamConsumer."""
    visible = strip_streaming_cursor(full_text)

    # Hermes REQUIRES_EDIT_FINALIZE adapters can receive a second finalize with
    # identical content after the stream was already closed. Re-emitting the
    # full text as a delta makes the browser append a duplicate reply.
    if state.finalized and finalize:
        return StreamBridgeAction(
            kind="done",
            delta="",
            seq=state.next_seq,
            message_id=state.message_id,
            done=True,
            content=visible,
            noop=True,
        )

    if state.message_id is None and not finalize:
        # No open stream — treat as fresh open.
        return begin_stream_delta(state, visible)

    if visible.startswith(state.last_visible):
        suffix = visible[len(state.last_visible) :]
        actions_delta = suffix
        seq = state.next_seq
        if suffix:
            state.last_visible = visible
            state.next_seq = seq + 1
        if finalize:
            msg_id = state.message_id
            content = visible
            state.last_visible = visible
            state.finalized = True
            return StreamBridgeAction(
                kind="done",
                delta=actions_delta,
                seq=seq,
                message_id=msg_id,
                done=True,
                content=content,
            )
        if not suffix:
            # No-op edit (cursor-only strip already applied).
            return StreamBridgeAction(
                kind="delta",
                delta="",
                seq=state.next_seq,
                message_id=state.message_id,
                done=False,
            )
        return StreamBridgeAction(
            kind="delta",
            delta=suffix,
            seq=seq,
            message_id=state.message_id,
            done=False,
        )

    # Non-prefix rewrite (rare) — replace with the new visible text on finalize.
    if finalize or state.message_id:
        msg_id = state.message_id
        content = visible
        state.last_visible = visible
        state.finalized = True
        return StreamBridgeAction(
            kind="done",
            delta="",
            seq=state.next_seq,
            message_id=msg_id,
            done=True,
            content=content,
        )

    return StreamBridgeAction(kind="passthrough", passthrough=True, content=visible)
