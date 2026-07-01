#!/usr/bin/env bash
# Enqueue a stability-test user message on WebUI and wait for Hermes to reply.
# Full browser-session path: login → create conversation → POST message → poll.
set -euo pipefail

HERMES_CONTAINER="${HERMES_CONTAINER:-hermes}"
WEBUI_URL="${WEBCHAT_URL:-$(docker exec "$HERMES_CONTAINER" printenv WEBCHAT_URL 2>/dev/null | tr -d '\r')}"
SERVICE_TOKEN="${WEBCHAT_SERVICE_TOKEN:-$(docker exec "$HERMES_CONTAINER" printenv WEBCHAT_SERVICE_TOKEN 2>/dev/null | tr -d '\r')}"
BOOTSTRAP_KEY="${BOOTSTRAP_USER_KEY:-dev-webui-key}"
WAIT_SEC="${STABILITY_WAIT_SEC:-2700}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

PROMPT="${STABILITY_PROMPT:-Give me the analysis of AT&T stock (T). Include:

- **Price Action & Technicals**: Current price, key moving averages (50/200-day MA), RSI, MACD, volume trends, and notable support/resistance levels.
- **Fundamentals Snapshot**: Trailing P/E, EPS, dividend yield, FCF yield, and any recent earnings beats/misses or guidance changes.
- **Catalysts & Risks**: M&A activity, debt paydown progress, fiber/5G capex plans, spectrum auctions, regulatory headwinds, or competitive threats from competitors and streaming providers.
- **Analyst Consensus**: Current consensus price target, rating distribution, and any recent upgrades/downgrades.
- **5-Year Outlook**: 
  - **Bull Case**: What needs to happen for T to hit \$X+ over 5 years (e.g., successful spin-off synergies, accelerated fiber penetration, AI-driven network optimization, dividend growth resumption).
  - **Base Case**: Realistic trajectory based on current capex cycle, debt trajectory, and market share stability.
  - **Bear Case**: What breaks the thesis (e.g., execution failures, rising interest rates pressuring valuation, competitive erosion, or macro recession impacting consumer/business spend).
  - **Dividend Outlook**: Is the current yield sustainable? Any risk of another cut, or realistic path to gradual increases?
  - **Valuation Framework**: How does T compare to peers (VZ, TMUS) on EV/EBITDA, P/FCF, and dividend coverage over a 5-year horizon?

Format as a clean, skimmable report with bullet points and brief narrative. Cite sources where possible.}"

if [[ -z "$WEBUI_URL" || -z "$SERVICE_TOKEN" ]]; then
  echo "WEBCHAT_URL and WEBCHAT_SERVICE_TOKEN are required." >&2
  exit 1
fi

echo "== Optional: lower Hermes compression threshold for long research turns =="
if [[ "${STABILITY_PATCH_COMPRESSION:-0}" == "1" ]]; then
  docker exec -u hermes "$HERMES_CONTAINER" /opt/hermes/.venv/bin/python - <<'PY'
from pathlib import Path
import re
p = Path("/opt/data/config.yaml")
text = p.read_text()
if re.search(r"^  threshold:\s*0\.35\s*$", text, re.M):
    text = re.sub(r"^  threshold:\s*0\.35\s*$", "  threshold: 0.25", text, count=1, flags=re.M)
    p.write_text(text)
    print("updated compression.threshold to 0.25")
else:
    print("compression.threshold unchanged (already patched or non-default)")
PY
fi

echo "== WebUI health =="
curl -sf -m 15 -H "Authorization: Bearer ${SERVICE_TOKEN}" "${WEBUI_URL}/api/internal/hermes/health" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('worker_online', d.get('worker',{}).get('isOnline')); print('queue', d.get('queue'))"

echo "== Login to WebUI =="
LOGIN_CODE=$(curl -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" \
  -X POST "${WEBUI_URL}/login?/default" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "apiKey=${BOOTSTRAP_KEY}" \
  --data-urlencode "return_to=/chat")
if [[ "$LOGIN_CODE" != "303" && "$LOGIN_CODE" != "302" && "$LOGIN_CODE" != "200" ]]; then
  echo "Login failed HTTP ${LOGIN_CODE} (set BOOTSTRAP_USER_KEY to match WebUI)" >&2
  exit 1
fi
echo "login ok (${LOGIN_CODE})"

echo "== Create conversation =="
CONV=$(curl -sf -b "$COOKIE_JAR" -X POST "${WEBUI_URL}/api/conversations" \
  -H "Content-Type: application/json" \
  -d '{"title":"Stability test (AT&T)"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['conversationId'])")
echo "conversation_id=${CONV}"
CHAT_URL="${WEBUI_URL}/chat?conversation=${CONV}"
echo "chat_url=${CHAT_URL}"

echo "== Enqueue user message =="
MSG_JSON=$(python3 -c 'import json,sys; print(json.dumps({"content": sys.stdin.read()}))' <<<"$PROMPT")
QUEUE=$(curl -sf -b "$COOKIE_JAR" -X POST "${WEBUI_URL}/api/conversations/${CONV}/messages" \
  -H "Content-Type: application/json" \
  -d "$MSG_JSON")
echo "$QUEUE" | python3 -m json.tool | head -10

USER_MSG_ID=$(echo "$QUEUE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('messageId',''))")
echo "user_message_id=${USER_MSG_ID}"

echo "== Waiting for Hermes response (up to ${WAIT_SEC}s) =="
DEADLINE=$(( $(date +%s) + WAIT_SEC ))
LAST_LEN=0
while [[ $(date +%s) -lt $DEADLINE ]]; do
  BODY=$(curl -sf -b "$COOKIE_JAR" "${WEBUI_URL}/api/conversations/${CONV}/messages")
  python3 - "$BODY" "$USER_MSG_ID" <<'PY'
import json, sys
body = json.loads(sys.argv[1])
user_id = sys.argv[2]
msgs = body.get("messages") or []
busy = body.get("assistantBusy")
run = body.get("runState") or {}
assistants = [m for m in msgs if m.get("role") == "assistant" and m.get("id") != user_id]
last = assistants[-1] if assistants else None
content = (last or {}).get("content") or ""
print(f"busy={busy} run={run.get('status')} assistants={len(assistants)} last_len={len(content)}")
if content:
    print("preview:", content[:200].replace("\n", " "))
PY
  LAST_LEN=$(python3 - "$BODY" <<'PY'
import json, sys
body = json.loads(sys.argv[1])
msgs = body.get("messages") or []
assistants = [m for m in msgs if m.get("role") == "assistant"]
print(len((assistants[-1] or {}).get("content") or "") if assistants else 0)
PY
)
  BUSY=$(python3 - "$BODY" <<'PY'
import json, sys
print(json.loads(sys.argv[1]).get("assistantBusy"))
PY
)
  if [[ "$BUSY" == "False" || "$BUSY" == "false" ]]; then
    ASSISTANTS=$(python3 - "$BODY" <<'PY'
import json, sys
msgs = json.loads(sys.argv[1]).get("messages") or []
print(sum(1 for m in msgs if m.get("role")=="assistant"))
PY
)
    if [[ "$ASSISTANTS" -ge 1 && "$LAST_LEN" -gt 500 ]]; then
      echo "== COMPLETE =="
      echo "chat_url=${CHAT_URL}"
      python3 - "$BODY" <<'PY'
import json, sys
msgs = json.loads(sys.argv[1]).get("messages") or []
for m in msgs:
    if m.get("role") == "assistant":
        c = m.get("content") or ""
        print("FINAL_LEN", len(c))
        print("===REPORT_START===")
        print(c[:6000])
        print("===REPORT_END===")
PY
      exit 0
    fi
  fi
  sleep 15
done

echo "Timed out waiting for assistant response" >&2
echo "chat_url=${CHAT_URL}"
exit 1
