#!/usr/bin/env bash
# ============================================================
# n8n Credential Configurator for Fimmick AISO
# Usage:
#   N8N_API_KEY="<n8n-public-api-key>" \
#   DATABASE_URL="<neon-postgres-connection-string>" \
#   OPENROUTER_KEY="<openrouter-api-key>" \
#   bash n8n/configure-credentials.sh
#
# DATABASE_URL is the app's least-privilege connection string (aeo_app, migration
# 037) — the same one in .env.local's DATABASE_URL, NOT MIGRATE_DATABASE_URL.
# n8n's queries here are plain SELECT/INSERT/UPDATE; nothing here needs DDL.
# Load it without echoing it, e.g.:
#   set -a; . ./.env.local; set +a
# ============================================================

set -euo pipefail

N8N_BASE="https://anfield-n8n.zeabur.app/api/v1"

if [[ -z "${N8N_API_KEY:-}" ]]; then
  echo "ERROR: N8N_API_KEY environment variable is required."
  echo "Get it from: https://anfield-n8n.zeabur.app/settings/api"
  exit 1
fi

AUTH_HEADER="X-N8N-API-KEY: ${N8N_API_KEY}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL env var required (Neon Postgres connection string)."
  echo "Get it from .env.local or the Neon console."
  exit 1
fi
export DATABASE_URL

if [[ -z "${OPENROUTER_KEY:-}" ]]; then
  echo "ERROR: OPENROUTER_KEY env var required"
  exit 1
fi

echo "==> Step 1: Update Postgres credential (ID: RVz4K04NALUIPrf4)"
# Build the credential payload with python3 so the connection string is parsed
# and JSON-escaped safely, and the password never lands in a shell argument.
PG_PAYLOAD_FILE=$(mktemp)
trap 'rm -f "$PG_PAYLOAD_FILE"' EXIT

python3 - "$PG_PAYLOAD_FILE" <<'PY'
import json, os, sys
from urllib.parse import parse_qs, unquote, urlparse

url = urlparse(os.environ['DATABASE_URL'])
if url.scheme not in ('postgres', 'postgresql') or not url.hostname or not url.username:
    sys.exit('ERROR: DATABASE_URL is not a valid postgres:// connection string')

sslmode = (parse_qs(url.query).get('sslmode') or ['require'])[0]
payload = {
    'name': 'Neon Postgres',
    'type': 'postgres',
    'data': {
        'host': url.hostname,
        'port': url.port or 5432,
        'database': unquote(url.path.lstrip('/')) or 'neondb',
        'user': unquote(url.username),
        'password': unquote(url.password or ''),
        'ssl': 'disable' if sslmode == 'disable' else 'require',
        'allowUnauthorizedCerts': False,
    },
}
with open(sys.argv[1], 'w') as fh:
    json.dump(payload, fh)
PY

POSTGRES_RESP=$(curl -s -X PATCH "$N8N_BASE/credentials/RVz4K04NALUIPrf4" \
  -H "${AUTH_HEADER}" \
  -H "Content-Type: application/json" \
  --data-binary @"$PG_PAYLOAD_FILE")
PG_ID=$(echo "$POSTGRES_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','ERROR: '+str(d.get('message',d))))")
echo "    Postgres credential ID: $PG_ID"

echo ""
echo "==> Step 2: Create OpenRouter HTTP Header credential"
OR_RESP=$(curl -s -X POST "$N8N_BASE/credentials" \
  -H "${AUTH_HEADER}" \
  -H "Content-Type: application/json" \
  --data-raw "{
    \"name\": \"OpenRouter API\",
    \"type\": \"httpHeaderAuth\",
    \"data\": {
      \"name\": \"Authorization\",
      \"value\": \"Bearer $OPENROUTER_KEY\"
    }
  }")
OR_ID=$(echo "$OR_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','ERROR: '+str(d.get('message',d))))")
echo "    OpenRouter credential ID: $OR_ID"

echo ""
echo "==> Step 3: Patch workflow nodes to use credential IDs"
# Fetch both workflows, replace credential placeholders, PUT them back

patch_workflow() {
  local WF_ID="$1"
  local WF_NAME="$2"

  WF=$(curl -s "$N8N_BASE/workflows/$WF_ID" -H "${AUTH_HEADER}")

  # Replace credential references in nodes
  PATCHED=$(echo "$WF" | python3 -c "
import sys, json
d = json.load(sys.stdin)
pg_id = '$PG_ID'
or_id = '$OR_ID'
for node in d.get('nodes', []):
    creds = node.get('credentials', {})
    if 'postgres' in creds:
        creds['postgres'] = {'id': pg_id, 'name': 'Neon Postgres'}
    if 'httpHeaderAuth' in creds:
        creds['httpHeaderAuth'] = {'id': or_id, 'name': 'OpenRouter API'}
    node['credentials'] = creds
# Keep only fields allowed in PUT
allowed = {k: d[k] for k in ['name','nodes','connections','settings','staticData'] if k in d}
print(json.dumps(allowed))
")

  PUT_RESP=$(curl -s -X PUT "$N8N_BASE/workflows/$WF_ID" \
    -H "${AUTH_HEADER}" \
    -H "Content-Type: application/json" \
    -d "$PATCHED")
  echo "    $WF_NAME: $(echo "$PUT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Updated' if 'id' in d else 'ERROR: '+str(d.get('message','')))")"
}

patch_workflow "fKyeS2AEBpdTlwsr" "AISO Scan Webhook"
patch_workflow "AN4OUG1YnJnzbuxA" "AI Pulse Weekly v2"

echo ""
echo "==> Step 4: Activate both workflows"
for ID in "fKyeS2AEBpdTlwsr" "AN4OUG1YnJnzbuxA"; do
  ACT=$(curl -s -X POST "$N8N_BASE/workflows/$ID/activate" \
    -H "${AUTH_HEADER}")
  echo "    $ID: $(echo "$ACT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Active ✓' if d.get('active') else 'Response: '+str(d.get('message',''))[:80])")"
done

echo ""
echo "==> All done!"
echo "    Scan webhook: https://anfield-n8n.zeabur.app/webhook/aiso-scan"
echo "    View workflows: https://anfield-n8n.zeabur.app/home/workflows"
