import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildScanWorkflow } from './build-scan-workflow.mjs'

/** Local review material only. This module contains no HTTP client or activation path. */
export function prepareScanWorkflow(workflowId, credentialId) {
  const key = /^[a-zA-Z0-9_-]{1,80}$/
  if (!key.test(workflowId ?? '') || !key.test(credentialId ?? '')) throw new Error('EXISTING_WORKFLOW_AND_OPENROUTER_CREDENTIAL_IDS_REQUIRED')
  const workflow = buildScanWorkflow()
  const provider = workflow.nodes.find(node => node.id === 'node-ai-summary')
  provider.credentials = { httpHeaderAuth: { id: credentialId, name: 'OpenRouter API' } }
  return { mode: 'LOCAL_PREPARATION_ONLY', method: 'PUT', path: '/api/v1/workflows/' + workflowId,
    workflowId, requiresActivationReview: true,
    body: { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2)
    if (args.includes('--apply')) throw new Error('NO_DEPLOYMENT_OR_ACTIVATION_SUPPORTED')
    const value = name => args[args.indexOf(name) + 1]
    const plan = prepareScanWorkflow(args.includes('--workflow-id') ? value('--workflow-id') : null,
      args.includes('--openrouter-credential-id') ? value('--openrouter-credential-id') : null)
    if (args.includes('--output')) writeFileSync(value('--output'), JSON.stringify(plan, null, 2) + '\n')
    else console.log(JSON.stringify(plan, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'PREPARATION_FAILED')
    process.exitCode = 1
  }
}
