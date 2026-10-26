#!/usr/bin/env bash
# Create the secured local scan workflow INACTIVE. Run configure-credentials.sh
# with the returned N8N_WORKFLOW_ID only after provisioning matching app/n8n secrets.
# Required: N8N_API_KEY and N8N_SCAN_WEBHOOK_SECRET (>=32 characters).
set -euo pipefail
umask 077

N8N_BASE="https://anfield-n8n.zeabur.app/api/v1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

python3 - "$SCRIPT_DIR/aiso-scan-webhook.json" "$WORK_DIR" <<'PY'
import json, os, sys
try:
    api_key = os.environ.get('N8N_API_KEY', '')
    secret = os.environ.get('N8N_SCAN_WEBHOOK_SECRET', '')
    if not api_key or len(secret) < 32 or any(char in api_key + secret for char in '\r\n'):
        raise ValueError()
    graph = json.load(open(sys.argv[1]))
    triggers = [node for node in graph['nodes'] if node.get('type') == 'n8n-nodes-base.webhook']
    if len(triggers) != 1 or triggers[0]['parameters'].get('authentication') != 'headerAuth':
        raise ValueError()
    if triggers[0].get('credentials', {}).get('httpHeaderAuth', {}).get('name') != 'AISO Scan Webhook':
        raise ValueError()
    with open(os.path.join(sys.argv[2], 'headers'), 'w') as out:
        out.write('X-N8N-API-KEY: ' + api_key + '\nContent-Type: application/json\n')
    payload = {key: graph[key] for key in ['name', 'nodes', 'connections', 'settings', 'staticData'] if key in graph}
    with open(os.path.join(sys.argv[2], 'workflow.json'), 'w') as out:
        json.dump(payload, out)
except Exception:
    sys.exit('ERROR: Invalid credentials or secured local workflow; no remote changes made.')
PY

if ! curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
  -X POST "$N8N_BASE/workflows" --header @"$WORK_DIR/headers" \
  --data-binary @"$WORK_DIR/workflow.json" --output "$WORK_DIR/response.json" 2>/dev/null; then
  echo 'ERROR: n8n workflow creation failed.' >&2
  exit 1
fi
WORKFLOW_ID=$(python3 - "$WORK_DIR/response.json" <<'PY'
import json, re, sys
try:
    response = json.load(open(sys.argv[1]))
    identifier = response.get('id')
    if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', identifier) or response.get('active') is not False:
        raise ValueError()
    print(identifier)
except Exception:
    sys.exit('ERROR: n8n did not confirm an inactive workflow; inspect the target before retrying.')
PY
)
echo "Created inactive scan workflow: $WORKFLOW_ID"
echo 'Bind all three credentials with configure-credentials.sh before activation.'
echo "Use N8N_WORKFLOW_ID=$WORKFLOW_ID for that operation."
