#!/usr/bin/env bash
# Install the secured local scan workflow, bind its credentials, then activate.
# Required: N8N_API_KEY, DATABASE_URL (aeo_app), OPENROUTER_KEY,
# N8N_SCAN_WEBHOOK_SECRET (same >=32-character value as the app).
# N8N_WORKFLOW_ID optionally selects the existing scan workflow.
set -euo pipefail
umask 077

N8N_BASE="https://anfield-n8n.zeabur.app/api/v1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
N8N_WORKFLOW_ID="${N8N_WORKFLOW_ID:-fKyeS2AEBpdTlwsr}"
PG_CREDENTIAL_ID="${N8N_POSTGRES_CREDENTIAL_ID:-RVz4K04NALUIPrf4}"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
export N8N_WORKFLOW_ID PG_CREDENTIAL_ID

# Credentials and headers travel through private files, never command arguments.
python3 - "$WORK_DIR" "$SCRIPT_DIR/aiso-scan-webhook.json" <<'PY'
import json, os, re, sys
from urllib.parse import parse_qs, unquote, urlparse

try:
    target = sys.argv[1]
    for name in ['N8N_API_KEY', 'OPENROUTER_KEY', 'N8N_SCAN_WEBHOOK_SECRET']:
        value = os.environ.get(name, '')
        if not value or '\r' in value or '\n' in value:
            raise ValueError('Missing or invalid ' + name)
    if len(os.environ['N8N_SCAN_WEBHOOK_SECRET']) < 32:
        raise ValueError('N8N_SCAN_WEBHOOK_SECRET must contain at least 32 characters')
    for name in ['N8N_WORKFLOW_ID', 'PG_CREDENTIAL_ID']:
        if not re.fullmatch(r'[A-Za-z0-9_-]+', os.environ[name]):
            raise ValueError('Invalid target identifier')
    url = urlparse(os.environ.get('DATABASE_URL', ''))
    if url.scheme not in ('postgres', 'postgresql') or not url.hostname or not url.username or not url.password:
        raise ValueError('DATABASE_URL must be a Postgres connection string')
    graph = json.load(open(sys.argv[2]))
    triggers = [node for node in graph['nodes'] if node.get('type') == 'n8n-nodes-base.webhook']
    if len(triggers) != 1 or triggers[0]['parameters'].get('authentication') != 'headerAuth':
        raise ValueError('Local workflow must require header authentication')
    if triggers[0].get('credentials', {}).get('httpHeaderAuth', {}).get('name') != 'AISO Scan Webhook':
        raise ValueError('Local workflow must reference its dedicated webhook credential')
    def save(name, payload):
        with open(os.path.join(target, name), 'w') as out:
            json.dump(payload, out)
    with open(os.path.join(target, 'headers'), 'w') as out:
        out.write('X-N8N-API-KEY: ' + os.environ['N8N_API_KEY'] + '\nContent-Type: application/json\n')
    save('postgres.json', {'name': 'Neon Postgres', 'type': 'postgres', 'data': {
        'host': url.hostname, 'port': url.port or 5432,
        'database': unquote(url.path.lstrip('/')) or 'neondb',
        'user': unquote(url.username), 'password': unquote(url.password),
        'ssl': 'disable' if (parse_qs(url.query).get('sslmode') or ['require'])[0] == 'disable' else 'require',
        'allowUnauthorizedCerts': False,
    }})
    save('provider.json', {'name': 'OpenRouter API', 'type': 'httpHeaderAuth', 'data': {
        'name': 'Authorization', 'value': 'Bearer ' + os.environ['OPENROUTER_KEY'],
    }})
    save('webhook.json', {'name': 'AISO Scan Webhook', 'type': 'httpHeaderAuth', 'data': {
        'name': 'Authorization', 'value': 'Bearer ' + os.environ['N8N_SCAN_WEBHOOK_SECRET'],
    }})
except Exception:
    sys.exit('ERROR: Invalid credentials, target, or secured local workflow; no remote changes made.')
PY

api_request() {
  local method="$1" path="$2" payload="${3:-}" expected="${4:-}" active="${5:-}"
  local args=(--fail --silent --show-error --connect-timeout 10 --max-time 30
    -X "$method" --header @"$WORK_DIR/headers" --output "$WORK_DIR/response.json")
  if [[ -n "$payload" ]]; then args+=(--data-binary @"$payload"); fi
  if ! curl "${args[@]}" "$N8N_BASE/$path" 2>/dev/null; then
    echo 'ERROR: n8n request failed; workflow activation stopped.' >&2
    return 1
  fi
  python3 - "$WORK_DIR/response.json" "$expected" "$active" <<'PY'
import json, re, sys
try:
    response = json.load(open(sys.argv[1]))
    identifier = response.get('id')
    if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', identifier):
        raise ValueError()
    if sys.argv[2] and identifier != sys.argv[2]:
        raise ValueError()
    if sys.argv[3] == 'active' and response.get('active') is not True:
        raise ValueError()
    if sys.argv[3] == 'inactive' and response.get('active') is not False:
        raise ValueError()
    print(identifier)
except Exception:
    sys.exit('ERROR: Invalid n8n response; workflow activation stopped.')
PY
}

# An existing legacy workflow may already be active. Confirm it is stopped
# before changing credentials; every later failure leaves it inactive.
api_request POST "workflows/$N8N_WORKFLOW_ID/deactivate" '' "$N8N_WORKFLOW_ID" inactive >/dev/null
PG_ID=$(api_request PATCH "credentials/$PG_CREDENTIAL_ID" "$WORK_DIR/postgres.json" "$PG_CREDENTIAL_ID")
OR_ID=$(api_request POST credentials "$WORK_DIR/provider.json")
WEBHOOK_ID=$(api_request POST credentials "$WORK_DIR/webhook.json")
export PG_ID OR_ID WEBHOOK_ID

# Always replace the remote graph with the secured reviewed local export.
# Fetching and reactivating the old graph would preserve its unauthenticated SQL.
python3 - "$SCRIPT_DIR/aiso-scan-webhook.json" "$WORK_DIR/workflow.json" <<'PY'
import json, os, sys
try:
    graph = json.load(open(sys.argv[1]))
    for node in graph['nodes']:
        credentials = node.get('credentials', {})
        if 'postgres' in credentials:
            credentials['postgres'] = {'id': os.environ['PG_ID'], 'name': 'Neon Postgres'}
        if 'httpHeaderAuth' in credentials:
            name = credentials['httpHeaderAuth']['name']
            if name not in ('OpenRouter API', 'AISO Scan Webhook'):
                raise ValueError()
            credentials['httpHeaderAuth'] = {'id': os.environ['WEBHOOK_ID' if name == 'AISO Scan Webhook' else 'OR_ID'], 'name': name}
    payload = {key: graph[key] for key in ['name', 'nodes', 'connections', 'settings', 'staticData'] if key in graph}
    with open(sys.argv[2], 'w') as out:
        json.dump(payload, out)
except Exception:
    sys.exit('ERROR: Cannot prepare secured local workflow; activation stopped.')
PY

api_request PUT "workflows/$N8N_WORKFLOW_ID" "$WORK_DIR/workflow.json" "$N8N_WORKFLOW_ID" >/dev/null
api_request POST "workflows/$N8N_WORKFLOW_ID/activate" '' "$N8N_WORKFLOW_ID" active >/dev/null
echo "Secured local scan workflow installed and activated: $N8N_WORKFLOW_ID"
