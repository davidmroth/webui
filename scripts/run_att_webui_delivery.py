#!/usr/bin/env python3
"""Run a stability-test prompt through Hermes and post results to WebUI.

Intended to run inside the Hermes gateway container (see scripts/README.md).
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import uuid

import httpx

os.environ.setdefault("HERMES_HOME", "/opt/data")

DEFAULT_PROMPT = """Give me the analysis of AT&T stock (T). Include:

- **Price Action & Technicals**: Current price, key moving averages (50/200-day MA), RSI, MACD, volume trends, and notable support/resistance levels.
- **Fundamentals Snapshot**: Trailing P/E, EPS, dividend yield, FCF yield, and any recent earnings beats/misses or guidance changes.
- **Catalysts & Risks**: M&A activity, debt paydown progress, fiber/5G capex plans, spectrum auctions, regulatory headwinds, or competitive threats from competitors and streaming providers.
- **Analyst Consensus**: Current consensus price target, rating distribution, and any recent upgrades/downgrades.
- **5-Year Outlook**: 
  - **Bull Case**: What needs to happen for T to hit $X+ over 5 years (e.g., successful spin-off synergies, accelerated fiber penetration, AI-driven network optimization, dividend growth resumption).
  - **Base Case**: Realistic trajectory based on current capex cycle, debt trajectory, and market share stability.
  - **Bear Case**: What breaks the thesis (e.g., execution failures, rising interest rates pressuring valuation, competitive erosion, or macro recession impacting consumer/business spend).
  - **Dividend Outlook**: Is the current yield sustainable? Any risk of another cut, or realistic path to gradual increases?
  - **Valuation Framework**: How does T compare to peers (VZ, TMUS) on EV/EBITDA, P/FCF, and dividend coverage over a 5-year horizon?

Format as a clean, skimmable report with bullet points and brief narrative. Cite sources where possible."""


def _env(name: str, default: str = "") -> str:
    val = os.environ.get(name, default).strip()
    if val:
        return val
    try:
        return subprocess.check_output(["printenv", name], text=True).strip()
    except Exception:
        return default


def post_assistant(
    base_url: str,
    token: str,
    conversation_id: str,
    content: str,
    *,
    role: str = "assistant",
) -> dict:
    url = (
        f"{base_url.rstrip('/')}/api/internal/hermes/conversations/"
        f"{conversation_id}/assistant"
    )
    response = httpx.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"content": content, "role": role},
        timeout=120.0,
    )
    response.raise_for_status()
    return response.json()


def main() -> int:
    webui = _env("WEBCHAT_URL")
    token = _env("WEBCHAT_SERVICE_TOKEN")
    conversation_id = _env("WEBUI_CONVERSATION_ID")
    hermes_base_url = _env("HERMES_BASE_URL")
    hermes_api_key = _env("HERMES_API_KEY", "llama.cpp")
    hermes_model = _env("HERMES_MODEL", "")
    prompt = _env("STABILITY_PROMPT", DEFAULT_PROMPT)

    missing = [
        name
        for name, val in (
            ("WEBCHAT_URL", webui),
            ("WEBCHAT_SERVICE_TOKEN", token),
            ("WEBUI_CONVERSATION_ID", conversation_id),
            ("HERMES_BASE_URL", hermes_base_url),
        )
        if not val
    ]
    if missing:
        print(f"Required env vars missing: {', '.join(missing)}", file=sys.stderr)
        return 1

    print("Posting simulated user request...", flush=True)
    post_assistant(
        webui,
        token,
        conversation_id,
        "**Simulated user message (stability test)**\n\n" + prompt,
    )
    post_assistant(
        webui,
        token,
        conversation_id,
        "⏳ Running stability-test prompt — fresh session, "
        "`web` + `search` + `terminal` + `file` tools only.",
    )

    from run_agent import AIAgent

    t0 = time.time()
    session_id = str(uuid.uuid4())
    agent = AIAgent(
        base_url=hermes_base_url,
        api_key=hermes_api_key,
        provider="custom",
        model=hermes_model,
        platform="webchat",
        session_id=session_id,
        quiet_mode=True,
        skip_memory=True,
        skip_context_files=True,
        enabled_toolsets=["web", "search", "terminal", "file"],
        max_iterations=int(_env("STABILITY_MAX_ITERATIONS", "18")),
        chat_id=conversation_id,
    )
    print(f"AGENT_START session={session_id}", flush=True)
    result = agent.run_conversation(prompt)
    final = (result.get("final_response") or "").strip()
    elapsed = time.time() - t0

    tools: list[str] = []
    for message in result.get("messages", []):
        if message.get("role") != "assistant" or not message.get("tool_calls"):
            continue
        for tool_call in message["tool_calls"]:
            name = (tool_call.get("function") or {}).get("name")
            if name:
                tools.append(name)

    header = (
        f"**✅ Stability test complete** — finished in {elapsed / 60:.1f} min\n"
        f"_Tools used: {', '.join(sorted(set(tools))) or 'none'}_\n\n"
    )
    if not final:
        final = "_No final response captured — check AgentLens for trace details._"

    print(f"Posting final report ({len(final)} chars)...", flush=True)
    post_assistant(webui, token, conversation_id, header + final)
    chat_url = f"{webui.rstrip('/')}/chat?conversation={conversation_id}"
    print(f"DONE {chat_url}", flush=True)
    print(f"ELAPSED_S={elapsed:.1f} TOOLS={sorted(set(tools))}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
