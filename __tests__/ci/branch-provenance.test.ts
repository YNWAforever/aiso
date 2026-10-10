import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { recordBranchProvenance } from '../../scripts/ci/record-branch-provenance.mjs'

const input = { projectId: 'weathered-wave-50814522', parentBranchId: 'br-square-mountain-az6f82vi', branchId: 'br-test-child-a123', branchName: 'test-123-1791007127897-abcdef12' }
const env = { AISO_RECORD_BRANCH_PROVENANCE: '1', GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '37101514082', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'integration', AISO_TEST_CHECKOUT_SHA: '3'.repeat(40) }
function temporary(action: (directory: string) => void) {
 const directory = mkdtempSync(join(tmpdir(), 'aiso-branch-provenance-'))
 try { action(directory) } finally {
  if (!resolve(directory).startsWith(resolve(tmpdir()) + '\\') && !resolve(directory).startsWith(resolve(tmpdir()) + '/')) throw Error('Unsafe temporary cleanup')
  rmSync(directory, { recursive: true, force: true })
 }
}

describe('durable test branch provenance', () => {
 it('is disabled without explicit recording and writes nothing', () => temporary(directory => {
  const target=join(directory,'absent')
  expect(recordBranchProvenance(input,{directory:target,env:{}})).toBeNull()
  expect(existsSync(target)).toBe(false)
 }))
 it('persists a bounded metadata-only record before the caller can be terminated', () => temporary(directory => {
  const code = `const {recordBranchProvenance}=await import(process.argv[1]); recordBranchProvenance(JSON.parse(process.argv[2]),JSON.parse(process.argv[3])); process.kill(process.pid,'SIGTERM')`
  const result=spawnSync(process.execPath,['--input-type=module','-e',code,pathToFileURL(resolve('scripts/ci/record-branch-provenance.mjs')).href,JSON.stringify(input),JSON.stringify({env,directory})],{encoding:'utf8',shell:false})
  expect(result.status).not.toBe(0)
  const record=JSON.parse(readFileSync(join(directory,`${input.branchId}.json`),'utf8'))
  expect(record).toMatchObject({...input,runId:env.GITHUB_RUN_ID,runAttempt:1,job:'integration',checkoutSha:env.AISO_TEST_CHECKOUT_SHA,event:'created'})
  expect(Object.keys(record).sort()).toEqual(['branchId','branchName','checkoutSha','event','job','parentBranchId','projectId','recordedAt','runAttempt','runId'].sort())
 }))
 it('cannot overwrite an earlier receipt', () => temporary(directory => {
  recordBranchProvenance(input,{directory,env})
  expect(()=>recordBranchProvenance(input,{directory,env})).toThrow()
 }))
 it('propagates a storage failure before setup proceeds', () => temporary(directory => {
  const target=join(directory,'occupied');writeFileSync(target,'x')
  expect(()=>recordBranchProvenance(input,{directory:target,env})).toThrow()
 }))
 for(const [key,value] of [['GITHUB_ACTIONS','false'],['GITHUB_RUN_ID','../123'],['GITHUB_RUN_ATTEMPT','0'],['GITHUB_JOB','../../other'],['AISO_TEST_CHECKOUT_SHA','not-a-sha']]) {
  it(`rejects invalid trusted CI context ${key}`,()=>temporary(directory=>{
   expect(()=>recordBranchProvenance(input,{directory,env:{...env,[key]:value}})).toThrow(/Invalid branch provenance/)
   expect(existsSync(join(directory,`${input.branchId}.json`))).toBe(false)
  }))
 }
 for(const [key,value] of [['branchId','../../production'],['projectId','postgresql://owner:secret@host/db'],['branchName','other-client'],['parentBranchId','br-test-child-a123']]) {
  it(`rejects invalid resource identity ${key}`,()=>temporary(directory=>{
   expect(()=>recordBranchProvenance({...input,[key]:value},{directory,env})).toThrow(/Invalid branch provenance/)
   expect(existsSync(join(directory,`${input.branchId}.json`))).toBe(false)
  }))
 }
 it('never persists extra credential fields supplied by a caller',()=>temporary(directory=>{
  recordBranchProvenance({...input,connectionUri:'postgresql://owner:DO_NOT_RECORD@host/db'} as typeof input,{directory,env})
  expect(readFileSync(join(directory,`${input.branchId}.json`),'utf8')).not.toContain('DO_NOT_RECORD')
 }))
 it('has no import-time write even when recording is enabled',()=>temporary(directory=>{
  const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(process.argv[1])`,pathToFileURL(resolve('scripts/ci/record-branch-provenance.mjs')).href],{cwd:directory,encoding:'utf8',shell:false,env:{...process.env,...env}})
  expect(result.status,result.stderr).toBe(0)
  expect(existsSync(join(directory,'artifacts'))).toBe(false)
 }))
 it('records after private registration and before credential lookup',()=>{
  const helper=readFileSync(resolve('__tests__/helpers/neon-branch.ts'),'utf8')
  const body=helper.slice(helper.indexOf('export function createTestBranch'))
  expect(body.indexOf('recordBranchProvenance(')).toBeGreaterThan(body.indexOf("created.set(id, '')"))
  expect(body.indexOf('recordBranchProvenance(')).toBeLessThan(body.indexOf("'connection-string', id"))
 })
})
