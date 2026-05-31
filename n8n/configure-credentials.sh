#!/usr/bin/env bash
# ============================================================
# n8n Credential Configurator for Fimmick AISO
# Usage:
#   DB_PASS="<supabase-db-password>" \
#   OPENROUTER_KEY="<openrouter-api-key>" \
#   bash n8n/configure-credentials.sh
# ============================================================

set -euo pipefail

N8N_BASE="https://anfield-n8n.zeabur.app/api/v1"
N8N_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYTdlYWY5NC1lYjg1LTQ4NmItYTY0NC04ZDRmN2JjOGQzZDkiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiYTRmNDYzNWMtMDIxNC00NjE5LWJkZTEtMmM1YmI4YmE0NjJhIiwiaWF0IjoxNzgwMTcwMjQ4LCJleHAiOjE3ODA3NjE2MDB9.Fvp8PlyddIy__C8vDLVqomCoHCMIALiHH7NyWqLLLnA"
AUTH="-H \"X-N8N-API-KEY: $N8N_KEY\""

if [[ -z "${DB_PASS:-}" ]]; then
  echo "ERROR: DB_PASS env var required (Supabase DB password)"
  exit 1
fi
if [[ -z "${OPENROUTER_KEY:-}" ]]; then
  echo "ERROR: OPENROUTER_KEY env var required"
  exit 1
fi

echo "==> Step 1: Update Postgres credential (ID: RVz4K04NALUIPrf4)"
POSTGRES_RESP=$(curl -s -X PATCH "$N8N_BASE/credentials/RVz4K04NALUIPrf4" \
  -H "X-N8N-API-KEY: $N8N_KEY" \
  -H "Content-Type: application/json" \
  --data-raw "{
    \"name\": \"Supabase Postgres\",
    \"type\": \"postgres\",
    \"data\": {
      \"host\": \"db.ankmnirpytvbidyjyujh.supabase.co\",
      \"port\": 5432,
      \"database\": \"postgres\",
      \"user\": \"postgres\",
      \"password\": \"$DB_PASS\",
      \"ssl\": \"require\",
      \"allowUnauthorizedCerts\": false
    }
  }")
PG_ID=$(echo "$POSTGRES_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','ERROR: '+str(d.get('message',d))))")
echo "    Postgres credential ID: $PG_ID"

echo ""
echo "==> Step 2: Create OpenRouter HTTP Header credential"
OR_RESP=$(curl -s -X POST "$N8N_BASE/credentials" \
  -H "X-N8N-API-KEY: $N8N_KEY" \
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

  WF=$(curl -s "$N8N_BASE/workflows/$WF_ID" -H "X-N8N-API-KEY: $N8N_KEY")

  # Replace credential references in nodes
  PATCHED=$(echo "$WF" | python3 -c "
import sys, json
d = json.load(sys.stdin)
pg_id = '$PG_ID'
or_id = '$OR_ID'
for node in d.get('nodes', []):
    creds = node.get('credentials', {})
    if 'postgres' in creds:
        creds['postgres'] = {'id': pg_id, 'name': 'Supabase Postgres'}
    if 'httpHeaderAuth' in creds:
        creds['httpHeaderAuth'] = {'id': or_id, 'name': 'OpenRouter API'}
    node['credentials'] = creds
# Keep only fields allowed in PUT
allowed = {k: d[k] for k in ['name','nodes','connections','settings','staticData'] if k in d}
print(json.dumps(allowed))
")

  PUT_RESP=$(curl -s -X PUT "$N8N_BASE/workflows/$WF_ID" \
    -H "X-N8N-API-KEY: $N8N_KEY" \
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
    -H "X-N8N-API-KEY: $N8N_KEY")
  echo "    $ID: $(echo "$ACT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Active ✓' if d.get('active') else 'Response: '+str(d.get('message',''))[:80])")"
done

echo ""
echo "==> All done!"
echo "    Scan webhook: https://anfield-n8n.zeabur.app/webhook/aiso-scan"
echo "    View workflows: https://anfield-n8n.zeabur.app/home/workflows"
