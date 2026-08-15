#!/usr/bin/env node
// stdin -> stdout filter that strips credentials. Pipe any command through it:
//   some-command 2>&1 | node scripts/redact.mjs
import { redactSecrets } from '../lib/security/redact-secrets.ts'

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { buffer += chunk })
process.stdin.on('end', () => { process.stdout.write(redactSecrets(buffer)) })
