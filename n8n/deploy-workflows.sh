#!/usr/bin/env bash
# ============================================================
# n8n Workflow Deployer
# Usage: N8N_API_KEY=<your-key> DATABASE_URL=<neon-connection-string> \
#          bash n8n/deploy-workflows.sh
#
# DATABASE_URL is the same Neon connection string the app uses (.env.local).
# Load it without echoing it, e.g.:
#   set -a; . ./.env.local; set +a
# ============================================================

set -euo pipefail

N8N_BASE="https://anfield-n8n.zeabur.app/api/v1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${N8N_API_KEY:-}" ]]; then
  echo "ERROR: N8N_API_KEY environment variable is required."
  echo "Get it from: https://anfield-n8n.zeabur.app/settings/api"
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL environment variable is required (Neon Postgres)."
  echo "Get it from .env.local or the Neon console."
  exit 1
fi
export DATABASE_URL

AUTH_HEADER="X-N8N-API-KEY: ${N8N_API_KEY}"

echo "==> Verifying n8n API access..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "${AUTH_HEADER}" "${N8N_BASE}/workflows")
if [[ "$STATUS" != "200" ]]; then
  echo "ERROR: API returned HTTP $STATUS. Check your API key."
  exit 1
fi
echo "    OK (HTTP 200)"

create_workflow() {
  local file="$1"
  local name="$2"
  echo ""
  echo "==> Creating workflow: ${name}"
  RESPONSE=$(curl -s -X POST "${N8N_BASE}/workflows" \
    -H "${AUTH_HEADER}" \
    -H "Content-Type: application/json" \
    -d @"${file}")
  ID=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','ERROR'))" 2>/dev/null || echo "PARSE_ERROR")
  if [[ "$ID" == "ERROR" || "$ID" == "PARSE_ERROR" ]]; then
    echo "    FAILED. Response: $RESPONSE"
  else
    echo "    Created! ID: ${ID}"
    echo "    URL: https://anfield-n8n.zeabur.app/workflow/${ID}"
  fi
}

create_workflow "${SCRIPT_DIR}/aiso-scan-webhook.json" "AISO Scan Webhook"
create_workflow "${SCRIPT_DIR}/ai-pulse-weekly-v2.json" "AI Pulse Weekly v2"

echo ""
echo "==> Done. Next steps:"
echo "    1. In n8n UI, create a credential named 'Neon Postgres'"
echo "       (or run: bash ${SCRIPT_DIR}/configure-credentials.sh)"
# Print the non-secret parts of DATABASE_URL only — never the password.
python3 - <<'PY'
import os, sys
from urllib.parse import parse_qs, unquote, urlparse

url = urlparse(os.environ['DATABASE_URL'])
if url.scheme not in ('postgres', 'postgresql') or not url.hostname or not url.username:
    sys.exit('ERROR: DATABASE_URL is not a valid postgres:// connection string')

sslmode = (parse_qs(url.query).get('sslmode') or ['require'])[0]
print(f"       Host: {url.hostname}")
print(f"       Port: {url.port or 5432}")
print(f"       Database: {unquote(url.path.lstrip('/')) or 'neondb'}")
print(f"       User: {unquote(url.username)}")
print("       Password: <password from DATABASE_URL — not printed>")
print(f"       SSL: {'disable' if sslmode == 'disable' else 'require'}")
PY
echo ""
echo "    2. Set environment variable OPENROUTER_API_KEY in n8n settings"
echo "       (Settings > Environment Variables)"
echo ""
echo "    3. Set environment variable CRON_SECRET in n8n settings"
echo "       Value: same as CRON_SECRET in .env.local"
echo ""
echo "    4. Update Slack webhook URLs in both workflows:"
echo "       Replace all 'https://hooks.slack.com/services/PLACEHOLDER/...'"
echo "       with your real Slack incoming webhook URL"
echo ""
echo "    5. Activate both workflows in the n8n UI (toggle ON)"
echo ""
echo "    6. For AISO Scan Webhook, the webhook path is: /webhook/aiso-scan"
echo "       Full URL: https://anfield-n8n.zeabur.app/webhook/aiso-scan"
echo "       Add this to your Next.js /api/scan route handler as a POST after saving scan"
